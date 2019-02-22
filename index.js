#!/usr/bin/env node
const
    argv = require('yargs'),
    path = require('path'),
    contentValidator = require('./content_validator');

argv
    .command({
        command: "$0 <path>",
        aliases: ["validate"],
        describe: "Scans a folder to validate Stackbit model conformity",
        builder: (yargs)=> {
            yargs.positional('path', {
                coerce: (userPath)=> path.join(process.cwd(), userPath),
                describe: "The path to the folder to scan",
                type: "string"
            });
        },
        handler: ({ path })=> contentValidator(path).log()
    })
    .help()
    .argv;