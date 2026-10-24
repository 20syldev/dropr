import hash from '../modules/v4/hash.js';
import { define } from './define.js';
export default define({
    name: 'hash',
    method: 'post',
    path: '/hash',
    category: 'security',
    params: {
        text: { required: true, missing: 'Please provide a text (?text={text})' },
        method: { required: true, missing: 'Please provide a valid hash algorithm (&method={algorithm})' },
        encoding: { options: ['hex', 'base64'], default: 'hex' },
    },
    example: { text: 'hello', method: 'sha256' },
    run: ({ text, method, encoding }) => hash(text, method, encoding),
});
//# sourceMappingURL=hash.js.map