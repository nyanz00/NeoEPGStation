const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;

const apiPath = path.join(__dirname, '..', 'api.yml');
const apiDocument = yaml.load(fs.readFileSync(apiPath, 'utf8'));
const validator = new OpenAPISchemaValidator({ version: apiDocument.openapi });
const result = validator.validate(apiDocument);

if (result.errors.length > 0) {
    console.error('api.yml validation failed:');
    console.error(JSON.stringify(result.errors, null, 2));
    process.exit(1);
}

console.log(`api.yml validation passed (${apiDocument.openapi}).`);
