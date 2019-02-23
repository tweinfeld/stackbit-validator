#!/usr/bin/env node
const
    _ = require('lodash'),
    fs = require('fs'),
    fp = require('lodash/fp'),
    argv = require('yargs'),
    path = require('path'),
    yaml = require('js-yaml'),
    inspect = require('util').inspect,
    { validatePage, validateModel } = require('.');

let arg = argv
    .options('output', {
        default: "pretty",
        global: true,
        choices: ["pretty", "raw"]
    })
    .command({
        command: "$0 <path>",
        aliases: ["verifyContent"],
        describe: "Scans a folder to validate against Stackbit's model",
        builder: (yargs)=> {
            yargs
                .option('contentFolder', {
                    describe: "Sets the name of the content folder",
                    default: "content",
                    type: "string"
                })
                .positional('path', {
                    coerce: (userPath)=> path.join(process.cwd(), userPath),
                    describe: "The path to the folder to scan",
                    type: "string"
                });
        },
        handler: ({ path, contentFolder, output })=>
            validatePage(path, contentFolder)
                .thru(
                    output === "pretty"
                        ? (stream)=> stream
                                .onError(fp.pipe(fp.get('message'), console.warn))
                                .onValue(({ path, error })=> error.length && console.log(`--[ ${path} ]--\n${error.map(({ message, path })=>`  ${message} ${ path && `(${path})` || "" }`).join('\n')}`))
                        : (stream)=> stream.log()
                )

    })
    .command({
        command: "verifyModel <path>",
        describe: "Test model file's validity",
        builder: (yargs)=> {
            yargs.positional('path', {
                coerce: fp.pipe(path.join.bind(process.cwd()), fp.partial(fs.readFileSync, [fp, { encoding: "utf8" }]), yaml.safeLoad, fp.get('models')),
                describe: "The path to the folder to scan",
                type: "string"
            });
        },
        handler: ({ output, path })=> {
            let res = validateModel(path);
            return output === "pretty"
                ? console.log(
                    _(res)
                        .map(({ name, error })=> error.length && `---> ${name}\n${error.map((message)=>`      ${message}`)}`)
                        .compact()
                        .thru((errors)=> errors.length ? errors.join('\n') : "All good!")
                        .value()
                )
                : console.log(res);
        }
    })
    .help()
    .argv;