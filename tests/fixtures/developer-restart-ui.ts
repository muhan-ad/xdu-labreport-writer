import '../../src/main.ts';
import catalog from '../../src/data/catalog.json';import samples from '../../src/data/test-measurements.json';
import {Repository} from '../../src/domain/repository.ts';import {privateStore} from '../../src/platform/storage.ts';import {importMeasurements} from '../../src/domain/model.ts';import type {Experiment} from '../../src/domain/types.ts';
const experiments=catalog.experiments as Experiment[],repo=new Repository(privateStore);
export async function seedInterrupted(){
 const records=[];for(const exp of experiments)records.push((await repo.load(exp)).record);
 await repo.saveDebugBackup(experiments,{version:1,createdAt:new Date().toISOString(),records});await repo.saveDebugOperation('fill');
 const exp=experiments[0];await repo.save(exp,{...records[0],draft:importMeasurements(exp,(samples as Record<string,unknown>)[exp.id])});
}
