import * as yaml from 'js-yaml';

const envTag = yaml.defineScalarTag('!env', {
    resolve: (name: string): string => {
        if (Object.prototype.hasOwnProperty.call(process.env, name) === false) {
            throw new Error(`Environment variable "${name}" is not defined`);
        }

        return process.env[name] as string;
    },
    identify: (): boolean => false,
});

const configSchema = yaml.CORE_SCHEMA.withTags(yaml.mergeTag, envTag);

/** Load application YAML, resolving !env scalar values and YAML merge keys. */
export function loadConfigYaml(source: string): unknown {
    return yaml.load(source, { schema: configSchema });
}
