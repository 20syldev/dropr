#!/usr/bin/env node
import { main } from './cli.js';

process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
});
