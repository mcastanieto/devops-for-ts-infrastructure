import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { Bucket } from '@pulumi/aws/s3';
import { Distribution } from '@pulumi/aws/cloudfront';
import { User } from '@pulumi/aws/iam';

export const createBucketPolicy = ({
  bucket,
  distribution,
}: {
  bucket: Bucket;
  distribution: Distribution;
}) =>
  aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        principals: [
          {
            type: 'Service',
            identifiers: ['cloudfront.amazonaws.com'],
          },
        ],
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
        conditions: [
          {
            test: 'StringEquals',
            values: [distribution.arn],
            variable: 'AWS:SourceArn',
          },
        ],
      },
    ],
  });