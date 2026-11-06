// Decisions of the release in progress, each one a visible change of a quirk; the ledger is emptied after the release
export const CHANGES = [
    {
        id: 'refused',
        area: 'rate limit',
        decision: 'change',
        synthetic: 'test/respond.test.mjs',
        was: 'A request refused by the per-client cap still counted against its client, so a client that kept asking stayed refused for as long as it did.',
        now: 'A refused request counts nowhere: the client is let through again as soon as its window holds fewer requests than the cap.',
        clients:
            'A client that hammered the server while refused, which is now let through one window after its last accepted request.',
        note: 'Refused requests do not count against the limit.',
    },
    {
        id: 'retry',
        area: '429 answers',
        decision: 'change',
        synthetic: 'test/respond.test.mjs',
        was: 'A 429 carried no hint about when to come back.',
        now: 'A 429 carries Retry-After, the whole seconds to wait, at least 1 and at most the window.',
        clients: 'Nobody breaks: the header is new, and a client that honours it stops asking too early.',
        note: 'A 429 carries Retry-After.',
    },
    {
        id: 'packagesenv',
        area: 'PACKAGES_DIR',
        decision: 'change',
        synthetic: 'test/app.test.mjs',
        was: 'The PACKAGES_DIR environment variable served another tree than the one of the config.',
        now: 'The variable is ignored: the --packages option of the command line does the same, and the config says the rest.',
        clients: 'An operator that set PACKAGES_DIR, whose server then serves the packagesDir of its config.',
        note: 'PACKAGES_DIR is replaced by --packages.',
    },
    {
        id: 'configpath',
        area: 'config file',
        decision: 'change',
        synthetic: 'test/app.test.mjs',
        was: 'Without an argument the config was the dropr.config.json at the root of the dropr folder, which a missing file refused.',
        now: 'Without an argument the config is dropr.config.json of the working folder, and defaults apply when it does not exist; a file named on the command line must exist.',
        clients:
            'An operator that started the server from another folder, which no longer finds the config of the repository.',
        note: 'The default config is the one of the working folder.',
    },
];
