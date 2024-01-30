import * as pulumi from '@pulumi/pulumi';

export const getARN = (awsThingy: any) =>
  pulumi.output(awsThingy).apply(t => t?.arn);
