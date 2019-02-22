const
    fs = require('fs'),
    fp = require('lodash/fp'),
    path = require('path'),
    yaml = require('js-yaml'),
    kefir = require('kefir'),
    minimatch = require('minimatch');

const
    MODEL_NAME_SYMBOL = Symbol('name'),
    TESTBED_FOLDER = path.join(__dirname, '.testbed'),
    MODEL_FILE_NAME = "content-model.yml",
    CONTENT_FILE_EXTENSION = '.md',
    CONTENT_FILES_FOLDER_NAME = 'content';

const
    toPosixPath = ((reg)=> (str)=> str.replace(reg, path.posix.sep))(new RegExp(fp.escapeRegExp(path.sep), 'g')),
    createFolderFilenameStream = (baseFolder)=> {
        return kefir
            .fromNodeCallback(fs.readdir.bind(null, baseFolder, { withFileTypes: false, encoding: "utf8" }))
            .flatten()
            .flatMap((entryName)=> {
                const entryPath = path.join(baseFolder, entryName);
                return kefir
                    .fromNodeCallback(fs.stat.bind(null, entryPath))
                    .flatMap((entryFsStat) => entryFsStat.isFile()
                            ? kefir.constant(entryPath)
                            : entryFsStat.isDirectory() ? createFolderFilenameStream(entryPath) : kefir.never());

            });
    };

const getContentWarningByModel = (function(library){
    return (allModels)=> (model, post)=> fp.flatMap(({ test, message })=> test(model, post) ? [message(model, post)] : [], library);
})([
    { "test": ({ hideContent }, { body: postBody })=> hideContent && !/^\s*$/.test(postBody), "message": fp.always('"hideContent" is set, but the post contains content') },
    { "test": ({ template: modelTemplate }, { front_matter: { template: postTemplate } })=> !fp.equals(modelTemplate, postTemplate), "message": ({ template: modelTemplate })=>`Templates mismatch (expected "${modelTemplate}")` },
    { "test": (model, { front_matter: postFrontmatter })=> {
        postFrontmatter
    }}
]);

const modelProperty = kefir
    .fromNodeCallback(fs.readFile.bind(null, path.join(TESTBED_FOLDER, MODEL_FILE_NAME)))
    .map(yaml.safeLoad)
    .map(fp.pipe(fp.get('models'), fp.map.convert({ 'cap': false })((v, k)=> ({ [MODEL_NAME_SYMBOL]: k, ...v }))))
    .flatMap((models)=> {
        const
            contentPath = path.join(TESTBED_FOLDER, CONTENT_FILES_FOLDER_NAME),
            validateModel = getContentWarningByModel(models);
        return createFolderFilenameStream(contentPath)
            .filter(fp.pipe(path.extname, fp.toLower, fp.equals(CONTENT_FILE_EXTENSION)))
            .flatMapConcurLimit((mdFilename)=> {
                return kefir
                    .fromNodeCallback(fs.readFile.bind(null, mdFilename, { encoding: "utf8", flag: "r" }))
                    .map((fileContents)=> {
                        const [rawFrontMatter, rawBody] = (fileContents.match(/([\s\S]+?)\r?\n\s*---\s*\r?\n?([\s\S]*)$/) || []).slice(1);
                        return {
                            path: toPosixPath(path.relative(contentPath, mdFilename)),
                            front_matter: fp.attempt(()=> yaml.safeLoad(rawFrontMatter)),
                            body: rawBody
                        };
                    });
            }, 2)
            .map((post)=> {
                const
                    { path: postPath, body: postBody, front_matter: postFrontmatter } = post,
                    matchingModels = fp.pipe(
                        fp.filter(({ type, file: modelPath, singleInstance = false, match = '**', exclude = '' })=> type === "page"
                            && ((singleInstance && modelPath)
                                ? postPath === modelPath
                                : (minimatch(postPath, match) && !minimatch(postPath, exclude)))
                        ),
                        fp.sortBy(({ singleInstance })=> singleInstance ? -1 : 1)
                    )(models);

                return {
                    path: postPath,
                    warning: fp.isError(postFrontmatter) ? ["Contains invalid front-matter block"] : [
                        !matchingModels.length && "No eligible models found to match",
                        matchingModels.filter(({ singleInstance, file })=> singleInstance && file).length > 1 && "More than one single-instance model matches",
                        ...(matchingModels[0] ? validateModel(matchingModels[0], post) : [])
                    ].filter(Boolean)
                };
            });
    })
    .log();





