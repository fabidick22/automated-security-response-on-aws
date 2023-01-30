// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { App, Aspects, DefaultStackSynthesizer, Stack } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { MemberStack } from './member-stack';

const description = 'ASR Member Stack';
const solutionId = 'SO9999';
const solutionTMN = 'my-solution-tmn';
const solutionVersion = 'v9.9.9';
const solutionDistBucket = 'sharrbukkit';

function getMemberStack(): Stack {
  const app = new App();
  const stack = new MemberStack(app, 'MemberStack', {
    analyticsReporting: false,
    synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
    description,
    solutionId,
    solutionTMN,
    solutionVersion,
    solutionDistBucket,
    runtimePython: Runtime.PYTHON_3_9,
  });
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  return stack;
}

describe('member stack', function () {
  const template = Template.fromStack(getMemberStack());

  it('snapshot matches', function () {
    expect(template).toMatchSnapshot();
  });

  it('description is present', function () {
    expect(template.toJSON().Description).toEqual(description);
  });

  describe('admin account template parameter', function () {
    const regex = /^\d{12}$/;

    describe('allowed pattern', function () {
      it('matches account number', function () {
        expect('1'.repeat(12)).toMatch(regex);
      });

      it('does not match too long account number', function () {
        expect('1'.repeat(13)).not.toMatch(regex);
      });

      it('does not match words', function () {
        expect('MyAdminAccnt').not.toMatch(regex);
      });
    });

    it('is present', function () {
      template.hasParameter('SecHubAdminAccount', {
        AllowedPattern: regex.source,
        Type: 'String',
      });
    });
  });

  describe('log group name', function () {
    const templateParameterName = 'LogGroupName';

    it('template parameter is present', function () {
      template.hasParameter(templateParameterName, {
        Type: 'String',
      });
    });

    it('SSM parameter is present', function () {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/Solutions/${solutionId}/Metrics_LogGroupName`,
        Type: 'String',
        Value: { Ref: templateParameterName },
      });
    });
  });

  describe('Redshift audit logging bucket', function () {
    const templateParameterName = 'CreateS3BucketForRedshiftAuditLogging';
    const conditionName = 'EnableS3BucketForRedShift4';
    const bucketLogicalId = 'S3BucketForRedShiftAuditLogging652E7355';

    it('template parameter is present', function () {
      template.hasParameter(templateParameterName, {
        AllowedValues: ['yes', 'no'],
        Default: 'no',
        Type: 'String',
      });
    });

    it('condition is present', function () {
      template.hasCondition(conditionName, {
        ['Fn::Equals']: [{ Ref: templateParameterName }, 'yes'],
      });
    });

    it('is present', function () {
      template.hasResource('AWS::S3::Bucket', {
        Condition: conditionName,
        DeletionPolicy: 'Retain',
        Properties: {
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              {
                ServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'AES256',
                },
              },
            ],
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
        UpdateReplacePolicy: 'Retain',
      });
    });

    it('policy is present', function () {
      template.hasResource('AWS::S3::BucketPolicy', {
        Condition: conditionName,
        DeletionPolicy: 'Retain',
        DependsOn: [bucketLogicalId],
        Properties: {
          Bucket: { Ref: bucketLogicalId },
          PolicyDocument: {
            Statement: [
              {
                Action: ['s3:GetBucketAcl', 's3:PutObject'],
                Effect: 'Allow',
                Principal: {
                  Service: 'redshift.amazonaws.com',
                },
                Resource: [
                  {
                    ['Fn::GetAtt']: [bucketLogicalId, 'Arn'],
                  },
                  {
                    ['Fn::Sub']: [
                      'arn:${AWS::Partition}:s3:::${BucketName}/*',
                      {
                        BucketName: {
                          Ref: bucketLogicalId,
                        },
                      },
                    ],
                  },
                ],
              },
              {
                Action: 's3:*',
                Condition: {
                  Bool: {
                    ['aws:SecureTransport']: 'false',
                  },
                },
                Effect: 'Deny',
                Principal: '*',
                Resource: [
                  {
                    ['Fn::GetAtt']: [bucketLogicalId, 'Arn'],
                  },
                  {
                    ['Fn::Join']: [
                      '',
                      [
                        {
                          ['Fn::GetAtt']: [bucketLogicalId, 'Arn'],
                        },
                        '/*',
                      ],
                    ],
                  },
                ],
              },
            ],
          },
        },
        UpdateReplacePolicy: 'Retain',
      });
    });

    it('encryption key alias SSM parameter is present', function () {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/Solutions/${solutionId}/afsbp/1.0.0/S3.4/KmsKeyAlias`,
        Type: 'String',
        Value: 'default-s3-encryption',
      });
    });
  });

  describe('remediation key', function () {
    const keyLogicalId = 'SHARRRemediationKeyE744743D';

    it('is present', function () {
      template.hasResource('AWS::KMS::Key', {
        DeletionPolicy: 'Retain',
        Properties: {
          EnableKeyRotation: true,
          KeyPolicy: {
            Statement: [
              {
                Action: [
                  'kms:GenerateDataKey',
                  'kms:GenerateDataKeyPair',
                  'kms:GenerateDataKeyPairWithoutPlaintext',
                  'kms:GenerateDataKeyWithoutPlaintext',
                  'kms:Decrypt',
                  'kms:Encrypt',
                  'kms:ReEncryptFrom',
                  'kms:ReEncryptTo',
                  'kms:DescribeKey',
                  'kms:DescribeCustomKeyStores',
                ],
                Effect: 'Allow',
                Principal: {
                  Service: [
                    'sns.amazonaws.com',
                    's3.amazonaws.com',
                    {
                      ['Fn::Join']: [
                        '',
                        [
                          'logs.',
                          {
                            Ref: 'AWS::URLSuffix',
                          },
                        ],
                      ],
                    },
                    {
                      ['Fn::Join']: [
                        '',
                        [
                          'logs.',
                          {
                            Ref: 'AWS::Region',
                          },
                          '.',
                          {
                            Ref: 'AWS::URLSuffix',
                          },
                        ],
                      ],
                    },
                    {
                      ['Fn::Join']: [
                        '',
                        [
                          'cloudtrail.',
                          {
                            Ref: 'AWS::URLSuffix',
                          },
                        ],
                      ],
                    },
                    'cloudwatch.amazonaws.com',
                  ],
                },
                Resource: '*',
              },
              {
                Action: 'kms:*',
                Effect: 'Allow',
                Principal: {
                  AWS: {
                    ['Fn::Join']: [
                      '',
                      [
                        'arn:',
                        {
                          Ref: 'AWS::Partition',
                        },
                        ':iam::',
                        {
                          Ref: 'AWS::AccountId',
                        },
                        ':root',
                      ],
                    ],
                  },
                },
                Resource: '*',
              },
            ],
          },
        },
        UpdateReplacePolicy: 'Retain',
      });
    });

    it('alias is present', function () {
      template.hasResourceProperties('AWS::KMS::Alias', {
        AliasName: `alias/${solutionId}-SHARR-Remediation-Key`,
        TargetKeyId: { ['Fn::GetAtt']: [keyLogicalId, 'Arn'] },
      });
    });

    it('alias SSM parameter is present', function () {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/Solutions/${solutionId}/CMK_REMEDIATION_ARN`,
        Type: 'String',
        Value: { ['Fn::GetAtt']: [keyLogicalId, 'Arn'] },
      });
    });
  });

  describe('nested stack', function () {
    const mappingName = 'SourceCode';
    const mappingKeyName = 'General';
    const keyPrefixKeyName = 'KeyPrefix';
    const bucketKeyName = 'S3Bucket';

    it('source code mapping is present', function () {
      template.hasMapping(mappingName, {
        [mappingKeyName]: {
          [keyPrefixKeyName]: `${solutionTMN}/${solutionVersion}`,
          [bucketKeyName]: solutionDistBucket,
        },
      });
    });

    function getExpectedTemplateURL(templatePath: string) {
      return {
        ['Fn::Join']: [
          '',
          [
            'https://',
            {
              ['Fn::FindInMap']: [mappingName, mappingKeyName, bucketKeyName],
            },
            `-reference.s3.amazonaws.com/`,
            {
              ['Fn::FindInMap']: [mappingName, mappingKeyName, keyPrefixKeyName],
            },
            `/${templatePath}`,
          ],
        ],
      };
    }

    it('for runbooks is present', function () {
      template.hasResourceProperties('AWS::CloudFormation::Stack', {
        TemplateURL: getExpectedTemplateURL('aws-sharr-remediations.template'),
      });
    });

    const expectedPlaybooks = ['AFSBP', 'CIS120', 'CIS140', 'PCI321', 'SC'];

    const expectedTemplateParameterProperties = {
      AllowedValues: ['yes', 'no'],
      Default: 'yes',
      Type: 'String',
    };

    expectedPlaybooks.forEach(function (playbook: string) {
      describe(`for playbook ${playbook}`, function () {
        const templateParameterName = `Load${playbook}MemberStack`;
        const conditionName = `load${playbook}Cond`;

        it('template parameter is present', function () {
          template.hasParameter(templateParameterName, expectedTemplateParameterProperties);
        });

        it('condition is present', function () {
          template.hasCondition(conditionName, {
            ['Fn::Equals']: [{ Ref: templateParameterName }, 'yes'],
          });
        });

        it('is present', function () {
          template.hasResource('AWS::CloudFormation::Stack', {
            Condition: conditionName,
            Properties: {
              Parameters: {
                SecHubAdminAccount: { Ref: 'SecHubAdminAccount' },
              },
              TemplateURL: getExpectedTemplateURL(`playbooks/${playbook}MemberStack.template`),
            },
          });
        });
      });
    });
  });

  it('solution version SSM parameter is present', function () {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/Solutions/${solutionId}/member-version`,
      Type: 'String',
      Value: solutionVersion,
    });
  });
});