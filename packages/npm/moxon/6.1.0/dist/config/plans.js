import { env } from './env.js';
export const plans = {
    business: {
        hourly: env.BUSINESS_LIMIT,
        burst: env.BUSINESS_BURST,
        tokens: env.BUSINESS_TOKEN_LIST,
    },
    pro: {
        hourly: env.PRO_LIMIT,
        burst: env.PRO_BURST,
        tokens: env.PRO_TOKEN_LIST,
    },
    advanced: {
        hourly: env.ADVANCED_LIMIT,
        burst: env.ADVANCED_BURST,
        tokens: env.ADVANCED_TOKEN_LIST,
    },
    default: {
        hourly: env.DEFAULT_LIMIT,
        burst: env.DEFAULT_BURST,
        tokens: [],
    },
};
export const globalLimit = env.GLOBAL_LIMIT; // 50 000/h
/**
 * Returns the plan matching a bearer token, or 'default'.
 * Returns null if the token is provided but invalid.
 */
export function getPlan(token) {
    if (!token)
        return { name: 'default', plan: plans.default };
    if (token === 'undefined')
        return null;
    for (const [name, plan] of Object.entries(plans)) {
        if (name === 'default')
            continue;
        if (plan.tokens.includes('undefined'))
            continue;
        if (plan.tokens.includes(token))
            return { name, plan };
    }
    return null;
}
//# sourceMappingURL=plans.js.map