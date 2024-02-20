import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import { BACKEND_SECRETS } from '../secretsManager/backendSecrets';
// NOTE2JOSH: add pulumi import
import * as pulumi from '@pulumi/pulumi';
import { Role } from '@pulumi/aws/iam';
// NOTE2JOSH: add getARN and getExistingCertificate import
import { getARN } from '../utils/getARN';
import { getExistingCertificate } from '../acm/getCertificate';

export const createBackend = () => {
  const apiConfig = new pulumi.Config('api');
  const config = new pulumi.Config();

  // NOTE2JOSH: make sure domain, subdomain, and domainName are added here
  const domain = config.get('domain') || 'umnum.net';
  const subdomain = 'api-' + (config.get('subdomain') || 'dev');
  const domainName = `${subdomain}.${domain}`;

  // NOTE2JOSH: specify that Fargate cluster, load balancer, etc are added here

  // An ECS cluster to deploy into
  const cluster = new aws.ecs.Cluster('cluster', {});

  // An ECR repository to store our application's container image
  //const repo = new awsx.ecr.Repository('repo', {
  //forceDelete: true,
  //lifecyclePolicy: {
  //rules: [
  //{
  //description: 'Max 1 image',
  //maximumNumberOfImages: 1,
  //tagStatus: 'any',
  //},
  //],
  //},
  //});

  // NOTE2JOSH: could probably just use the previous backend image from the existing ECR
  const existingImage = aws.ecr.getImageOutput({
    repositoryName: domain,
    mostRecent: true,
  });

  const zone = aws.route53.getZoneOutput({ name: domain });

  const containerPort = apiConfig.getNumber('containerPort') || 1337;

  const containerName =
    apiConfig.get('containerName') || 'dev-backend-container';

  const cpu = apiConfig.getNumber('cpu') || 256;

  const memory = apiConfig.getNumber('memory') || 512;

  const secretsManger = new aws.secretsmanager.Secret('api-secrets');

  const secretVersion = new aws.secretsmanager.SecretVersion(
    'api-secrets-version',
    {
      secretId: secretsManger.id,
      secretString: JSON.stringify(BACKEND_SECRETS),
    }
  );

  const taskDefinition = new awsx.ecs.FargateTaskDefinition('api-task-def', {
    container: {
      name: containerName,
      image: existingImage.imageUri,
      cpu: cpu,
      memory: memory,
      essential: true,
      portMappings: [
        {
          hostPort: containerPort,
          containerPort: containerPort,
        },
      ],
      secrets: Object.keys(BACKEND_SECRETS).map(secretName => ({
        name: secretName,
        valueFrom: pulumi.interpolate`${secretsManger.arn}:${secretName}::`,
      })),
    },
  });

  const secretManagerPolicyDoc = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        effect: 'Allow',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [secretsManger.arn],
      },
    ],
  });

  const secretManagerPolicy = new aws.iam.Policy('secretsPolicy', {
    policy: secretManagerPolicyDoc.json,
  });

  const rpaSecrets = new aws.iam.RolePolicyAttachment('rpa-secrets', {
    role: taskDefinition.executionRole as pulumi.Output<Role>,
    policyArn: secretManagerPolicy.arn,
  });

  // An ALB to serve the container endpoint to the internet
  const loadBalancer = new awsx.lb.ApplicationLoadBalancer('loadbalancer', {
    listener: {
      certificateArn: getARN(getExistingCertificate(domain)),
      port: 443,
      protocol: 'HTTPS',
      sslPolicy: 'ELBSecurityPolicy-2016-08',
    },
    defaultSecurityGroup: {
      args: {
        ingress: [
          {
            fromPort: 443,
            protocol: 'tcp',
            toPort: 443,
            cidrBlocks: ['0.0.0.0/0'],
            ipv6CidrBlocks: ['::/0'],
          },
        ],
      },
    },
    defaultTargetGroup: {
      port: containerPort,
      protocol: 'HTTP',
      targetType: 'ip',
      healthCheck: {
        enabled: true,
        matcher: '200-204',
        path: '/_health',
        interval: 60 * 3,
        protocol: 'HTTP',
      },
    },
  });

  // Fetch the default VPC information from your AWS account:
  const vpc = new awsx.ec2.DefaultVpc('default-vpc');

  const ecsSecurityGroup = new aws.ec2.SecurityGroup('ECSSecurityGroup', {
    vpcId: vpc.vpcId,
    ingress: [
      // allow incoming traffic on 1337 from our loadbalancer
      {
        fromPort: 1337,
        toPort: 1337,
        protocol: 'tcp',
        securityGroups: [
          // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
          loadBalancer.defaultSecurityGroup.apply(sg => sg?.id!),
        ],
      },
    ],
    egress: [
      // allow all outgoing traffic
      {
        fromPort: 0,
        toPort: 0,
        protocol: '-1',
        cidrBlocks: ['0.0.0.0/0'],
        ipv6CidrBlocks: ['::/0'],
      },
    ],
  });

  // Deploy an ECS Service on Fargate to host the application container
  const service = new awsx.ecs.FargateService('service', {
    // desiredCount: 0, //  use this line to turn the service on/off
    cluster: cluster.arn,
    taskDefinition: taskDefinition.taskDefinition.arn,
    loadBalancers: [
      {
        containerName: containerName,
        containerPort: containerPort,
        targetGroupArn: loadBalancer.defaultTargetGroup.arn,
      },
    ],
    networkConfiguration: {
      assignPublicIp: true,
      subnets: vpc.publicSubnetIds,
      securityGroups: [ecsSecurityGroup.id],
    },
  });

  const record = new aws.route53.Record(domainName, {
    name: subdomain,
    zoneId: zone.zoneId,
    type: 'A',
    aliases: [
      {
        name: loadBalancer.loadBalancer.dnsName,
        zoneId: loadBalancer.loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

  return {
    imageUri: existingImage.imageUri,
    loadBalancerUrl: pulumi.interpolate`http://${loadBalancer.loadBalancer.dnsName}`,
    repoName: domain,
    serviceName: service.service.name,
    clusterName: cluster.name,
    containerName,
  };
};
