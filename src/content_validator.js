const
    _ = require('lodash'),
    fs = require('fs'),
    fp = require('lodash/fp'),
    path = require('path'),
    yaml = require('js-yaml'),
    kefir = require('kefir'),
    minimatch = require('minimatch');

const
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
    },

    validateContent = (allModels, model, content)=> {

        const validationErrors = [];
        let registerValidationMessage = (message, path)=> validationErrors.push({ message, path }) && false;

        const validateNode = function(modelNode, contentPath = ""){

            const
                contentNode = contentPath ? _.get(content, contentPath) : content,
                modelType = _.get(modelNode, 'type');

            const iterateFields = (contentNode)=> {
                return [
                    _(modelNode)
                        .chain()
                        .get('fields')
                        .filter({ required: true })
                        .map('name')
                        .map((fieldName)=> _.has(contentNode, fieldName) || registerValidationMessage(`Required field ${fieldName} is missing`, contentPath))
                        .every(Boolean)
                        .value(),
                        _(contentNode)
                            .omit('menus', 'template')
                            .keys()
                            .map((key)=> {
                                const nextModelNode = _(modelNode).chain().get('fields').find({ name: key }).value();
                                return (!!nextModelNode || registerValidationMessage(`Could not find a model definition for field "${key}"`, contentPath)) && validateNode(nextModelNode, [contentPath, key].filter(Boolean).join('.'));
                            })
                            .every(Boolean)
                    ].reduce((a, b)=> a && b);
            };

            return (!!modelType || registerValidationMessage(`"type" isn't defined in this node's model`, contentPath)) && (({
                "object": iterateFields,
                "page": iterateFields,
                "number": (contentNode)=> _.isNumber(contentNode) || registerValidationMessage(`Boolean expected`, contentPath),
                "boolean": (contentNode)=> _.isBoolean(contentNode) || registerValidationMessage(`Boolean expected`, contentPath),
                "text": (contentNode)=> _.isString(contentNode) || registerValidationMessage(`Text expected`, contentPath),
                "string": (contentNode)=> _.isString(contentNode) || registerValidationMessage(`String expected`, contentPath),
                "image": (contentNode)=> _.isString(contentNode) || registerValidationMessage(`Image expected`, contentPath),
                "markdown": (contentNode)=> _.isString(contentNode) || registerValidationMessage(`Markdown expected`, contentPath),
                "list": (contentNode)=> _(contentNode).map((nextContentNode, index)=> {
                    const nextModelNode = _.get(modelNode, 'items');
                    return (nextModelNode || registerValidationMessage(`List doesn't contain "items" model`, contentPath)) && validateNode(nextModelNode, [contentPath, `[${index}]`].filter(Boolean).join(''));
                }).every(Boolean),
                "reference": (contentNode)=> {

                    let
                        ref = registerValidationMessage,
                        localMessages = [];

                    let res = (modelNode["models"] || []).some((nextModelPath)=> {
                        registerValidationMessage = (message, path)=> localMessages.push({ message: `Attempting model "${nextModelPath}": ${message}`, path }) && false;
                        const nextModelNode = _.get(allModels, nextModelPath);
                        return validateNode(nextModelNode, contentPath);
                    });

                    registerValidationMessage = ref;
                    return res || localMessages.some(({ message, path })=> registerValidationMessage(message, path));
                },
                "enum": (contentNode)=> {
                    return _(modelNode).chain().get('options').includes(contentNode).value() || registerValidationMessage(`Invalid enum value "${_.toString(contentNode)}"`,contentPath);
                }
            })[modelType] || (()=> registerValidationMessage(`Unknown field type "${modelType}"`, contentPath)))(contentNode);
        };

        validateNode(model);
        return validationErrors;
    },
    validateExternal = (function(testLibrary){
        return (allModels, model, post)=> fp.flatMap(({test, message}) => test(model, post, allModels) ? message(model, post, allModels) : [], testLibrary);
    })([
        { "test": ({ hideContent }, { body: postBody })=> hideContent && !/^\s*$/.test(postBody), "message": fp.always([{ message: '"hideContent" is set, but the post contains content' }]) },
        { "test": ({ template: modelTemplate }, { front_matter: { template: postTemplate } })=> !fp.equals(modelTemplate, postTemplate), "message": ({ template: modelTemplate }, { front_matter: { template: postTemplate } })=> [{ message: `Templates mismatch (expected "${modelTemplate}", got "${postTemplate}")` }] },
        { "test": (model, { front_matter })=> model && front_matter, "message": (model, { front_matter }, allModels)=> validateContent(allModels, model, front_matter) }
    ]);

module.exports = function(folder, contentFilesFolder = CONTENT_FILES_FOLDER_NAME, modelFile = MODEL_FILE_NAME, contentFileExtension = CONTENT_FILE_EXTENSION){

    return kefir
        .fromNodeCallback(fs.readFile.bind(null, path.join(folder, modelFile)))
        .map(fp.pipe(yaml.safeLoad, fp.get('models')))
        .flatMap((models)=> {
            const contentPath = path.join(folder, contentFilesFolder);
            return createFolderFilenameStream(contentPath)
                .filter(fp.pipe(path.extname, fp.toLower, fp.equals(contentFileExtension)))
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
                        error: fp.isError(postFrontmatter) ? [{ message: "Contains invalid front-matter block", internal: postFrontmatter }] : [
                            !matchingModels.length && { message: "No eligible models found to match" },
                            matchingModels.filter(({ singleInstance, file })=> singleInstance && file).length > 1 && { message: "More than one single-instance model matches" },
                            ...validateExternal(models, matchingModels[0], post)
                        ].filter(Boolean)
                    };
                });
        });
};