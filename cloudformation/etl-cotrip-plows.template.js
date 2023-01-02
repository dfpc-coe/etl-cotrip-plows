import cf from '@mapbox/cloudfriend';
import Lambda from './lib/lambda.js';

export default cf.merge(
    Lambda,
    {
        Description: 'Template for @tak-ps/etl',
        Parameters: {
            GitSha: {
                Description: 'GitSha that is currently being deployed',
                Type: 'String'
            },
        }
    }
);
