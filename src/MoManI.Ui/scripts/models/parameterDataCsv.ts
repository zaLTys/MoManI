﻿import _ = require('lodash');
import setDataModel = require('models/setData')

interface IDimensionItem {
    value: string;
    displayName: string;
}

interface IDimension {
    setId: string;
    index: number;
    name: string;
    numeric: boolean;
    values: IDimensionItem[];
}

interface IParameterCsvData {
    parameter: IParameter;
    columnDimensions: IDimension[];
    rows: number;
    data: IParameterData;
}

class Dimension implements IDimension {
    setId: string;
    index: number;
    name: string;
    numeric: boolean;
    values: IDimensionItem[];

    constructor(setId: string, index: number, name: string, numeric: boolean, values: IDimensionItem[]) {
        this.setId = setId;
        this.index = index;
        this.name = name;
        this.numeric = numeric;
        this.values = values;
    }

    sameDimensionAs(other: Dimension) {
        return this.setId == other.setId && this.index == other.index;
    }
}

class CsvDimensionStore {
    private dimensions: IDimension[];
    private setDatas: setDataModel.SetData[];
    private fixedSetId: string;
    private axisSetId: string;

    constructor(modelId: string, sets: ISet[], setDatas: ISetData[], axisSetId: string, fixedSetId?: string) {
        this.dimensions = [];
        this.setDatas = _.map(setDatas, setData => {
            var set = _.find(sets, s => s.id == setData.setId);
            return new setDataModel.SetData(modelId, set, setData);
        });
        this.fixedSetId = fixedSetId;
        this.axisSetId = axisSetId;
    }

    updateAndRetrieveDimensions: (parameter: IParameter) => IDimension[] = (parameter: IParameter) => {
        return _.map(parameter.sets, (setId, i) => {
            var previousSetIds = parameter.sets.slice(0, i);
            var index = _.filter(previousSetIds, psId => psId == setId).length;
            var dimension = _.find(this.dimensions, d => d.setId == setId && d.index == index);
            if (dimension) {
                return dimension;
            }
            var setData = _.find(this.setDatas, sd => sd.setId == setId);
            dimension = {
                setId: setId,
                index: index,
                name: setData.setName,
                numeric: setData.numeric,
                values: _.map(setData.getValueNamePairs(), valueName => {
                    var onlyDisplayValue = valueName.value == valueName.name || !valueName.name;
                    return {
                        value: valueName.value,
                        displayName: onlyDisplayValue ? valueName.value : `${valueName.value} (${valueName.name})`,
                    }
                }),
            };
            this.dimensions.push(dimension);
            return dimension;
        });
    }

    getFixedDimension = () => {
        if (this.fixedSetId == null)
            return null
        return _.find(this.dimensions, d => d.setId == this.fixedSetId && d.index == 0);
    }

    getUnfixedDimensions = () => {
        return _.filter(this.dimensions, d => d != this.getFixedDimension());
    }

    getAxisDimension = () => {
        return _.minBy(_.filter(this.getUnfixedDimensions(), ud => ud.setId == this.axisSetId), d => d.index);
    }

    getColumnDimensions = () => {
        return _.filter(this.getUnfixedDimensions(), d => d != this.getAxisDimension());
    }

    getAllDimensions = () => {
        return this.dimensions;
    }
}

export class ParameterDataCsv {
    scenarioId: string;
    modelId: string;
    actualSetValue: string;
    
    private dimensionStore: CsvDimensionStore;
    private unshownParameterData: IParameterData[];

    spreadsheetVisible: boolean;
    spreadsheetSettings: any;
    spreadsheetItems: (number | string)[][];

    constructor(modelId: string, scenarioId: string, parameters: IParameter[], sets: ISet[], parameterDatas: IParameterData[], setDatas: ISetData[], axisSetId: string, actualSetId?: string, actualSetValue?: string) {
        this.scenarioId = scenarioId;
        this.modelId = modelId;
        this.actualSetValue = actualSetValue;
        this.dimensionStore = new CsvDimensionStore(modelId, sets, setDatas, axisSetId, actualSetId);
        this.unshownParameterData = [];

        var parameterDimensions = _.map(_.orderBy(parameters, p => p.name), parameter => {
            var dimensions = this.dimensionStore.updateAndRetrieveDimensions(parameter);
            var columnDimensions = _.filter(dimensions, d => d != this.dimensionStore.getFixedDimension() && d != this.dimensionStore.getAxisDimension());
            return <IParameterCsvData>{
                parameter: parameter,
                columnDimensions: columnDimensions,
                rows: _.reduce(columnDimensions, (res, d) => res * d.values.length, 1),
                data: _.find(parameterDatas, pd => pd.parameterId == parameter.id),
            };
        });
        
        var rowCount = _.sumBy(parameterDimensions, pd => pd.rows);
        this.setupSpreadsheet(rowCount);
        
        _.forEach(parameterDimensions, (parameterDimension, parameterDimensionIndex) => {
            var startingRow = _.sum(_.map(parameterDimensions.slice(0, parameterDimensionIndex), ppd => ppd.rows));

            for (var rowIndex = startingRow; rowIndex < startingRow + parameterDimension.rows; rowIndex++) {
                this.spreadsheetItems[rowIndex][0] = parameterDimension.parameter.name;
                this.spreadsheetItems[rowIndex][this.spreadsheetSettings.columns.length] = parameterDimension.parameter.id;
            };

            var currentRowGroups = 1;
            _.forEach(this.dimensionStore.getColumnDimensions(), (setData, columnIndex) => {
                if (_.some(parameterDimension.columnDimensions, d => d == setData)) {

                    var repetitionSize = parameterDimension.rows / currentRowGroups;
                    var lumpSize = repetitionSize / setData.values.length;
                    var repetitions = parameterDimension.rows / repetitionSize;

                    for (var rep = 0; rep < repetitions; rep++) {
                        _.forEach(setData.values, (val, valueIndex) => {
                            for (var i = 0; i < lumpSize; i++) {
                                var rowIndex = startingRow + rep * repetitionSize + valueIndex * lumpSize + i;
                                this.spreadsheetItems[rowIndex][columnIndex + 1] = val.displayName;
                            };
                        });
                    };
                    currentRowGroups = currentRowGroups * setData.values.length;


                } else {
                    for (var rowIndex = startingRow; rowIndex < startingRow + parameterDimension.rows; rowIndex++) {
                        this.spreadsheetItems[rowIndex][columnIndex + 1] = '-';
                    };
                }
            });
        });
        
        this.loadData(parameterDimensions);

        this.spreadsheetVisible = true;
    }

    private setupSpreadsheet = (rowCount: number) => {
        var parameterNameColumns = [{
            readOnly: true,
        }];
        var indexColumns = _.times(this.dimensionStore.getColumnDimensions().length, () => {
            return {
                readOnly: true,
            }
        });
        var axisDimension = this.dimensionStore.getAxisDimension();
        var valueColumns = axisDimension
            ? _.times(axisDimension.values.length, () => {
                return {
                    readOnly: false,
                    type: 'numeric',
                    format: '0.[000000000]',
                }
            })
            : [{
                readOnly: false,
                type: 'numeric',
                format: '0.[000000000]',
            }];
        var columns = ['Parameter'].concat(_.map(this.dimensionStore.getColumnDimensions(), s => s.name)).concat(axisDimension ? _.map(axisDimension.values, v => v.value) : ['Value']);

        this.spreadsheetSettings = {
            columnSorting: true,
            colHeaders: columns,
            columns: parameterNameColumns.concat(indexColumns).concat(valueColumns),
        };
        columns.push('parameterId');

        this.spreadsheetItems = _.times(rowCount, () => {
            return _.map(columns, () => null);
        });
    }

    private loadData = (parameterDimensions: IParameterCsvData[]) => {

        var valueColumnStartIndex = this.dimensionStore.getColumnDimensions().length + 1;
        var axisDimension = this.dimensionStore.getAxisDimension();
        
        var dataMappingFunction = (parameterDimension: IParameterCsvData, rowContents: (string | number)[], colValue?: string) => {
            var actualOrderedValues = _.map(parameterDimension.data.sets, set => {
                var dimension = _.find(parameterDimension.columnDimensions, dim => dim.setId == set.id && dim.index == set.index);
                if (dimension == null) {
                    if (axisDimension && axisDimension.setId == set.id && axisDimension.index == set.index)
                        return colValue;
                    return this.actualSetValue;
                }
                var column = _.findIndex(this.dimensionStore.getColumnDimensions(), dimension) + 1;
                return rowContents[column];
            });
            return actualOrderedValues.join('|');
        };

        _.forEach(parameterDimensions, (parameterDimension, parameterDimensionIndex) => {
            if (!parameterDimension.data) {
                this.unshownParameterData.push({
                    modelId: this.modelId,
                    scenarioId: this.scenarioId,
                    parameterId: parameterDimension.parameter.id,
                    defaultValue: 0,
                    sets: _.map(parameterDimension.parameter.sets, (setId, index) => {
                        var instanceIndex = _(parameterDimension.parameter.sets).slice(0, index).filter(sId => sId == setId).value().length;
                        return {
                            id: setId,
                            index: instanceIndex,
                        }
                    }),
                    data: [],
                });
                return;
            }

            var stringgedData = _.map(parameterDimension.data.data, data => {
                return {
                    coordinates: data.c,
                    coordinateString: data.c.join('|'),
                    value: data.v,
                };
            });

            var startingRow = _.sum(_.map(parameterDimensions.slice(0, parameterDimensionIndex), ppd => ppd.rows));

            if (axisDimension) {
                for (var row = startingRow; row < startingRow + parameterDimension.rows; row++) {
                    for (var i = 0; i < axisDimension.values.length; i++) {
                        var mappedCoordinates = dataMappingFunction(parameterDimension, this.spreadsheetItems[row], axisDimension.values[i].value);
                        var found = _.find(stringgedData, data => data.coordinateString == mappedCoordinates);
                        if (found) {
                            stringgedData.splice(stringgedData.indexOf(found), 1);
                        }
                        var value = found ? found.value : parameterDimension.data.defaultValue;
                        this.spreadsheetItems[row][valueColumnStartIndex + i] = value;
                    }
                }
            } else {
                for (var row = startingRow; row < startingRow + parameterDimension.rows; row++) {
                    var mappedCoordinates = dataMappingFunction(parameterDimension, this.spreadsheetItems[row]);
                    var found = _.find(stringgedData, data => data.coordinateString == mappedCoordinates);
                    if (found) {
                        stringgedData.splice(stringgedData.indexOf(found), 1);
                    }
                    var value = found ? found.value : parameterDimension.data.defaultValue;
                    this.spreadsheetItems[row][valueColumnStartIndex] = value;
                }
            }
            
            this.unshownParameterData.push({
                modelId: parameterDimension.data.modelId,
                scenarioId: parameterDimension.data.scenarioId,
                parameterId: parameterDimension.data.parameterId,
                defaultValue: parameterDimension.data.defaultValue,
                sets: parameterDimension.data.sets,
                data: _.map(stringgedData, d => {return {
                    c: d.coordinates,
                    v: d.value,
                }})
            });
        });
    }

    serialize: () => IParameterData[] = () => {
        return _.map(_.groupBy(this.spreadsheetItems, r => r[this.spreadsheetSettings.columns.length]), (rows, parameterId) => {
            var unshownParameterData = _.find(this.unshownParameterData, d => d.parameterId == parameterId);
            var data = unshownParameterData.data.slice();

            var valueColumnStartIndex = this.dimensionStore.getColumnDimensions().length + 1;
            var axisDimension = this.dimensionStore.getAxisDimension();
            var fixedDimension = this.dimensionStore.getFixedDimension();
            var columns = this.dimensionStore.getColumnDimensions();

            var columnIndexMap = _.map(unshownParameterData.sets, dimension => {
                var index = _.findIndex(columns, col => col.setId == dimension.id && col.index == dimension.index);
                if (index < 0)
                    return null;
                return index + 1;
            });
            var coordinateFunction = (row: (string|number)[], valueIndex?: number) => {
                return _.map(unshownParameterData.sets, (dimension, index) => {
                    var mappedColumnIndex = columnIndexMap[index];
                    if (mappedColumnIndex)
                        return row[mappedColumnIndex].toString();
                    if (axisDimension.setId == dimension.id && axisDimension.index == dimension.index) {
                        return axisDimension.values[valueIndex].value;
                    }
                    if (fixedDimension && fixedDimension.setId == dimension.id && fixedDimension.index == dimension.index) {
                        return this.actualSetValue;
                    }
                    throw 'err';
                });
            };

            _.forEach(rows, row => {
                if (axisDimension) {
                    for (var i = 0; i < axisDimension.values.length; i++) {
                        var val = +row[valueColumnStartIndex + i];
                        if (val == unshownParameterData.defaultValue)
                            continue;
                        var coordinates = coordinateFunction(row, i);
                        data.push({
                            c: coordinates,
                            v: val,
                        });
                    }
                } else {
                    var val = +row[valueColumnStartIndex];
                    if (val == unshownParameterData.defaultValue)
                        return;
                    var coordinates = coordinateFunction(row);
                    data.push({
                        c: coordinates,
                        v: val,
                    });
                }
            });

            return {
                modelId: this.modelId,
                scenarioId: this.scenarioId,
                parameterId: parameterId,
                defaultValue: unshownParameterData.defaultValue,
                sets: unshownParameterData.sets,
                data: data,
            };
        });
    }
}