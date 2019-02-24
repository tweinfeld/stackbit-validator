const _ = require('lodash');

module.exports = (allModels, path)=> {
    const scanLevel = function(model, path){
        return [{
            path,
            error: (function({ type, label, template, file, singleInstance, match, exclude, labelField, fields }){
                return  _([
                    !type && `"type" is not defined`,
                    type && !["page", "object", "data", "config"].includes(type) && `Model is of unknown type, should be either "page", "object", "data" or "config"`,
                    !label && `"Label is not defined"`,
                    type === "page" && !template && `Page model is missing a "template" field`,
                    type === "page" && singleInstance && !file && `Page defined as "singleInstance", but "file" is not defined`,
                    type === "page" && singleInstance && (match || exclude) && `Page defined as "singleInstance", but "match" or "exclude" are specified`,
                    type === "page" && !labelField && (!!labelField && _.has(fields, labelField)) && `labelField "${labelField}" not found in fieldset`
                ])
                .compact()
                .value();
            })(model)
        }, ..._(model)
            .chain()
            .get('fields')
            .filter(({ type })=> ["object", "page", "data", "config"].includes(type))
            .map(({ name, ...model })=> scanLevel(model, [path, name].join('.')))
            .flatten()
            .value()
        ];
    };

    return _(allModels).map((model, name)=> scanLevel(model, name)).flatten().value();
};