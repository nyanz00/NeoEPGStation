import metadataPackage from 'arib-subtitle-timedmetadater';

// This CommonJS dependency exports its constructor under `default`.
const MetadataTransform = metadataPackage.default;
type MetadataTransform = InstanceType<typeof MetadataTransform>;
export default MetadataTransform;
