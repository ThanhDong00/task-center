import { EVENT_TYPES } from '@taskcenter/contracts';
import { dataSource } from './db';

console.log(`group-service owns ${dataSource.options.database}; knows ${Object.values(EVENT_TYPES).length} event types.`);
