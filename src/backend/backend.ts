import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import { BACKEND_SECRETS } from '../secretsManager/backendSecrets';

export const createBackend = () => {
  // An ECR repository to store our application's container image
  const repo = new awsx.ecr.Repository('repo', {
    forceDelete: true,
    lifecyclePolicy: {
      rules: [
        {
          description: 'Max 1 image',
          maximumNumberOfImages: 1,
          tagStatus: 'any',
        },
      ],
    },
  });

  const secretsManger = new aws.secretsmanager.Secret('api-secrets');

  const secretVersion = new aws.secretsmanager.SecretVersion(
    'api-secrets-version',
    {
      secretId: secretsManger.id,
      secretString: JSON.stringify(BACKEND_SECRETS),
    }
  );

  return {
    repoName: repo.repository.name,
  };
};
