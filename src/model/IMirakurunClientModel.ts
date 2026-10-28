import TunerServerAccessModel from './tuner/TunerServerAccessModel.js';

export default interface IMirakurunClientModel {
    getClient(): TunerServerAccessModel;
}
