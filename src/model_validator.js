const _ = require('lodash');

module.exports = function(model){
    return _(model).map(({ type, label, template, file, singleInstance, match, exclude }, name)=> {
        return {
            name,
            error: _([
                !type && `"type" is not defined`,
                type && !["page", "object", "data", "config"].includes(type) && `Model is of unknown type, should be either "page", "object", "data" or "config"`,
                !label && `"Label is not defined"`,
                type === "page" && !template && `Page model is missing a "template" field`,
                type === "page" && singleInstance && !file && `Page defined as "singleInstance", but "file" is not defined`,
                type === "page" && singleInstance && (match || exclude) && `Page defined as "singleInstance", but "match" or "exclude" are specified`
            ])
            .compact()
            .value()
        };
    }).value();
};