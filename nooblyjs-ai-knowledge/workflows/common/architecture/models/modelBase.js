/**
 * @fileoverview Model Base functions to be used by all Architecture classes
 * @method authenticate : Authenticate agains the ARIS system by using the username and password and returning a token
 * @method isAuthenticated : Determine if a token is still valid
 *
 * @author Digital Technologies Team
 * @update 2026-06-20
 */

'use strict';

// Leverage our file utilites
const { writeJSONFile, readJSONFile, writeFile, readFile, fileExists, fileModifiedTime } = require('../filesystem/filesystem');

/**
 * Model Base class to be used by all Architecture classes
 * @class
 */
class ModelBase {

    /**
     * Construction
     * @param {string} settings
     * @param {string } datafolder - The location of the data folder to be used for caching and storing models. This should be passed in the settings object as datafolder
     */
    constructor(settings) {
        // Check if there is a data folder being passed
        if (settings.datafolder == null){
            throw new Error('A datafolder location must be provided in the settings')
        }

        this.datafolder = settings.datafolder
    }

    /**
     * Test if a model cache exists
     * @param {string} model - The model id
     * @returns boolean if cache exists
     */
    modelExists(model) {
        return fileExists(`${this.datafolder}/models/${model}.json`)
    }

    /**
     * Read a cached model file
     * @param {string} model  - The model id
     * @returns 
     */
    readModel(model) {
        return readJSONFile(`${this.datafolder}/models/${model}.json`);
    }

    /**
     * Write a cached model file
     * @param {string} model  - The model id
     * @param {string} JSONData - The model data
     * @returns 
     */
    writeModel(model, JSONData) {
        writeJSONFile(`${this.datafolder}/models/${model}.json`, JSONData )
    }

    /**
     * Test if a search result exists
     * @param {string} object - The object
     * @returns boolean if cache exists
     */
    searchExists(object) {
        return fileExists(`${this.datafolder}/search/${object}.json`)
    }

    /**
     * Read a search file
     * @param {string} object  - The object
     * @returns
     */
    readSearch(object) {
        return readJSONFile(`${this.datafolder}/search/${object}.json`);
    }

    /**
     * The modified time of a cached search file. Search results carry no
     * "Last change" attribute (unlike models), so freshness is judged from the
     * cache file's own mtime.
     * @param {string} object - The object
     * @returns {Date|null} The mtime, or null when the cache is missing
     */
    searchModifiedTime(object) {
        return fileModifiedTime(`${this.datafolder}/search/${object}.json`);
    }

    /**
     * Write a search file
     * @param {string} object  - The object
     * @param {string} JSONData - The model data
     * @returns 
     */
    writeSearch(object, JSONData) {
        writeJSONFile(`${this.datafolder}/search/${object}.json`, JSONData)
    }

    /**
     * Test if a cache file exists
     * @param {string} filename - The filename
     * @returns boolean if cache exists
     */
    cacheExists(filename) {
        return fileExists(`${this.datafolder}/cache/${filename}`)
    }

    /**
     * Read a cached file
     * @param {string} filename  - filename
     * @returns 
     */
    readCache(filename) {
        return readJSONFile(`${this.datafolder}/cache/${filename}`);
    }

    /**
     * Write a cached file
     * @param {string} filename  - The model id
     * @param {string} content - The model data
     * @returns 
     */
    writeCache(filename, JSONData) {
        writeJSONFile(`${this.datafolder}/cache/${filename}`, JSONData)
    }

    /**
     * Format the model so it is easier to undrestand
     * @param {string} modelData 
     * @returns 
     */
    formatModel(modelData){
        let fomattedModel = {attributes: {}, modelObjects: {}, modelconnections:[]};
        fomattedModel.attributes.kind = modelData.items[0].kind;

        // Check if this is proper data
        if (modelData.items[0].modelobjects == null){
            return "{}"
        }

        // Add any model attributes
        for (let i =0; i < modelData.items[0].attributes.length; i++){  
            let key = modelData.items[0].attributes[i].typename;
            let value = this.santiseField(modelData.items[0].attributes[i].value);
            fomattedModel.attributes[key] = value;
        }
        
        // Add Model Objects
        for (let j =0; j < modelData.items[0].modelobjects.length; j++){ 
            // Create container
            let modelObject = {}  
            modelObject.guid = modelData.items[0].modelobjects[j].guid
            modelObject.type = modelData.items[0].modelobjects[j].typename
            modelObject.symbol = modelData.items[0].modelobjects[j].symbolname
            modelObject.connections = [];

            // Add Assignments
            modelObject.assignments = [];
            if (modelData.items[0].modelobjects[j].assignments != null){
                for (let l =0; l < modelData.items[0].modelobjects[j].assignments.length; l++){  
                    let model = modelData.items[0].modelobjects[j].assignments[l].target_guid;
                    let name = modelData.items[0].modelobjects[j].assignments[l].name;
                    let type = modelData.items[0].modelobjects[j].assignments[l].typename
                    modelObject.assignments.push({model, name, type});
                }
            }   

            // Add Attributes
            modelObject.attributes = {};
            for (let m =0; m < modelData.items[0].modelobjects[j].attributes.length; m++){  
                let key = modelData.items[0].modelobjects[j].attributes[m].typename;
                let value = this.santiseField(modelData.items[0].modelobjects[j].attributes[m].value);
                modelObject.attributes[key] = value;
            }

            // Add the Model Object
            fomattedModel.modelObjects[modelObject.guid]= modelObject;
        }

        // Add the model connections
        if(modelData.items[0].modelconnections != null){
            for (let k =0; k < modelData.items[0].modelconnections.length; k++){  

                let modelconnection = {};
                modelconnection.type = modelData.items[0].modelconnections[k].typename;
                modelconnection.srcmodel = modelData.items[0].modelconnections[k].source_guid;
                modelconnection.srcmodelname = fomattedModel.modelObjects[modelData.items[0].modelconnections[k].source_guid].attributes.Name;
                modelconnection.targetmodel = modelData.items[0].modelconnections[k].target_guid;
                modelconnection.targetmodelname = fomattedModel.modelObjects[modelData.items[0].modelconnections[k].target_guid].attributes.Name;
                
                // Add Assignments
                modelconnection.assignments = [];
                if (modelData.items[0].modelconnections[k].assignments != null){
                    for (let n = 0; n < modelData.items[0].modelconnections[k].assignments.length; n++){  
                        let assignment = modelData.items[0].modelconnections[k].assignments[n];
                        let model = assignment.target_guid;
                        let name = assignment.name;
                        let type = assignment.typename
                        modelconnection.assignments.push({model, name, type});
                    }
                }   

                // Add Attributes
                modelconnection.attributes = {};
                if(modelData.items[0].modelconnections[k].attributes != null){
                    for (let o = 0; o < modelData.items[0].modelconnections[k].attributes.length; o++){  
                        let attribute = modelData.items[0].modelconnections[k].attributes[o];
                        let key = attribute.typename;
                        let value = this.santiseField(attribute.value);
                        modelconnection.attributes[key] = value;
                    }
                }

                // Add the data to the model connections array;
                fomattedModel.modelObjects[modelData.items[0].modelconnections[k].source_guid].connections.push(modelconnection)
                fomattedModel.modelObjects[modelData.items[0].modelconnections[k].target_guid].connections.push(modelconnection)
            }
        }
        return fomattedModel
    }

    /**
     * Various sanisations of data
     * @param {string} data 
     * @returns 
     */
    santiseField(data="") {
        return data.replaceAll('"', '')
            .replaceAll(/\r?\n|\r/g, ' ')
            .replaceAll("\n"," ")
            .replaceAll("\r"," ")
            .replaceAll("\\","/")
            .replaceAll("{","(")
            .replaceAll("}",")")
            .replaceAll("|"," ")
            ;
    }

}

module.exports =  ModelBase;