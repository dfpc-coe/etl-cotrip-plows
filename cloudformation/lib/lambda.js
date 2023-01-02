import cf from '@mapbox/cloudfriend';

export default {
    Resources: {
        ETLFunctionLogs: {
            Type: 'AWS::Logs::LogGroup',
            Properties: {
                LogGroupName: cf.join(['/aws/lambda/', cf.stackName]),
                RetentionInDays: 7
            }
        },
        ETLFunction: {
            Type: 'AWS::Lambda::Function',
            Properties: {
                FunctionName: cf.stackName,
                KmsKeyArn: cf.getAtt('KMS', 'Arn'),
                MemorySize: 128,
                Timeout: 60,
                Description: 'Perform ETL for TAK ETL Server',
                PackageType: 'Image',
                Role: cf.getAtt('ETLFunctionRole', 'Arn'),
                Code: {
                    ImageUri: cf.join([cf.accountId, '.dkr.ecr.', cf.region, '.amazonaws.com/coe-ecr-etl-tasks:etl-cotrip-plows', cf.ref('GitSha')])
                }
            }
        },
        ETLFunctionRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
                RoleName: cf.join([cf.stackName, '-lambda-role']),
                AssumeRolePolicyDocument: {
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        Principal: {
                            Service: 'lambda.amazonaws.com'
                        },
                        Action: 'sts:AssumeRole'
                    }]
                },
                Path: '/',
                Policies: [],
                ManagedPolicyArns: [
                    'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
                ]
            }
        }
    }
};
