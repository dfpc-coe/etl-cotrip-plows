import ETL, { Event, SchemaType, handler as internal, local, InputFeature, InputFeatureCollection, DataFlowType, InvocationType } from '@tak-ps/etl';
import { Static, Type, TSchema } from '@sinclair/typebox';
import moment from 'moment-timezone';

const InputSchema = Type.Object({
    'COTRIP_TOKEN': Type.String({ description: 'API Token for CoTrip' }),
    'Show Only Active': Type.Boolean({ description: 'Limit Plows to showing only ones that are actively transmitting', default: true }),
    'Show Only Driving': Type.Boolean({ description: 'Limit Plows to showing only ones that are reported as driving', default: true }),
    'DEBUG': Type.Boolean({ description: 'Print GeoJSON Features in logs', default: false })
});

export default class Task extends ETL {
    static name = 'etl-cotrip-plows';
    static flow = [ DataFlowType.Incoming ];
    static invocation = [ InvocationType.Schedule ];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return InputSchema;
            } else {
                return Type.Object({
                    fleet: Type.String(),
                    vehicle_type: Type.String(),
                    vehicle_subtype: Type.String(),
                    current_status_state: Type.String(),
                    current_status_info: Type.String(),
                    collection_timestamp: Type.String(),
                    odometer: Type.Number()
                });
            }
        } else {
            return Type.Object({});
        }
    }

    async control() {
        const env = await this.env(InputSchema);

        const api = 'https://data.cotrip.org/';
        if (!env.COTRIP_TOKEN) throw new Error('No COTrip API Token Provided');
        const token = env.COTRIP_TOKEN;

        const plows = [];
        let batch = -1;
        let res;
        do {
            console.log(`ok - fetching page ${++batch}  of plows`);
            const url = new URL('/api/v1/snowPlows', api);
            url.searchParams.append('apiKey', String(token));
            if (res) url.searchParams.append('offset', res.headers.get('next-offset'));

            res = await fetch(url);

            plows.push(...(await res.json()).features);
        } while (res.headers.has('next-offset') && res.headers.get('next-offset') !== 'None');
        console.log(`ok - fetched ${plows.length} plows`);

        const features: Static<typeof InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: plows.filter((plow: any) => {
                if (env['Show Only Active']) {
                    return !['Inactive', 'Unknown'].includes(plow.avl_location.current_status.state);
                } else {
                    return true;
                }
            }).filter((plow) => {
                if (env['Show Only Driving']) {
                    return plow.avl_location.current_status.info === 'Driving';
                } else {
                    return true;
                }
            }).filter((plow) => {
                return moment(Math.floor(plow.avl_location.source.collection_timestamp * 1000)).isAfter(moment().subtract(1, 'hour'));
            }).map((plow) => {
                const feat = {
                    id: plow.avl_location.vehicle.id + '_' + plow.avl_location.vehicle.id2,
                    type: 'Feature',
                    properties: {
                        type: 'a-f-G-E-V-A-T-H',
                        how: 'm-g',
                        callsign: `${plow.avl_location.vehicle.fleet} ${plow.avl_location.vehicle.type}`,
                        course: plow.avl_location.position.bearing,
                        speed: plow.avl_location.position.speed * 0.44704,
                        metadata: {
                            fleet: plow.avl_location.vehicle.fleet,
                            vehicle_type: plow.avl_location.vehicle.type,
                            vehicle_subtype: plow.avl_location.vehicle.subtype,
                            current_status_state: plow.avl_location.current_status.state,
                            current_status_info: plow.avl_location.current_status.info,
                            collection_timestamp: moment(Math.floor(plow.avl_location.source.collection_timestamp * 1000)).tz('America/Denver').format('YYYY-MM-DD HH:mm z'),
                            odometer: plow.avl_location.position.odometer
                        }
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [
                            plow.avl_location.position.longitude,
                            plow.avl_location.position.latitude
                        ]
                    }
                };

                return feat as Static<typeof InputFeature>;
            })
        };

        await this.submit(features);
    }
}

await local(new Task(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(new Task(import.meta.url), event);
}
