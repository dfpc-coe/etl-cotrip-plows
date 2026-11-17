import ETL, { Event, SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';
import { Feature } from '@tak-ps/node-cot';
import { Static, Type, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import moment from 'moment-timezone';

const InputSchema = Type.Object({
    'COTRIP_TOKEN': Type.String({ description: 'API Token for CoTrip' }),
    'Show Only Active': Type.Boolean({ description: 'Limit Plows to showing only ones that are actively transmitting', default: true }),
    'Show Only Driving': Type.Boolean({ description: 'Limit Plows to showing only ones that are reported as driving', default: true }),
    'DEBUG': Type.Boolean({ description: 'Print GeoJSON Features in logs', default: false })
});

const Label = Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()]));

const PlowResponse = Type.Object({
    features: Type.Array(Type.Object({
        avl_location: Type.Object({
            vehicle: Type.Object({
                id: Label,
                id2: Label,
                fleet: Label,
                type: Label,
                subtype: Type.Optional(Type.Unknown())
            }),
            position: Type.Object({
                latitude: Type.Optional(Type.Unknown()),
                longitude: Type.Optional(Type.Unknown()),
                bearing: Type.Optional(Type.Unknown()),
                speed: Type.Optional(Type.Unknown()),
                odometer: Type.Optional(Type.Unknown())
            }),
            current_status: Type.Object({
                state: Type.Optional(Type.Unknown()),
                info: Type.Optional(Type.Unknown())
            }),
            source: Type.Object({
                collection_timestamp: Type.Optional(Type.Unknown())
            })
        })
    }))
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
            if (type === SchemaType.Input) return InputSchema;

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

        return Type.Object({});
    }

    async control(): Promise<void> {
        const env = await this.env(InputSchema);

        const api = 'https://data.cotrip.org/';
        if (!env.COTRIP_TOKEN) throw new Error('No COTrip API Token Provided');
        const token = env.COTRIP_TOKEN;

        const plows: Static<typeof PlowResponse>['features'] = [];
        let batch = -1;
        let res;
        do {
            console.log(`ok - fetching page ${++batch}  of plows`);
            const url = new URL('/api/v1/snowPlows', api);
            url.searchParams.append('apiKey', token);
            if (res) {
                const nextOffset = res.headers.get('next-offset');
                if (nextOffset) url.searchParams.append('offset', nextOffset);
            }

            res = await fetch(url);

            const body: unknown = await res.json();
            if (!Value.Check(PlowResponse, body)) throw new Error('Unexpected COTrip snowPlows response');

            plows.push(...body.features);
        } while (res.headers.has('next-offset') && res.headers.get('next-offset') !== 'None');
        console.log(`ok - fetched ${plows.length} plows`);

        const features: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: plows.filter((plow) => {
                if (!env['Show Only Active']) return true;

                const { state } = plow.avl_location.current_status;
                return !(typeof state === 'string' && ['Inactive', 'Unknown'].includes(state));
            }).filter((plow) => {
                if (!env['Show Only Driving']) return true;

                return plow.avl_location.current_status.info === 'Driving';
            }).filter((plow) => {
                return moment(Math.floor(Number(plow.avl_location.source.collection_timestamp) * 1000)).isAfter(moment().subtract(1, 'hour'));
            }).flatMap((plow) => {
                const { vehicle, position, current_status, source } = plow.avl_location;

                if (typeof position.longitude !== 'number' || typeof position.latitude !== 'number') {
                    console.error(`not ok - skipping plow ${vehicle.id}_${vehicle.id2}: no position`);
                    return [];
                }

                const feat: Static<typeof Feature.InputFeature> = {
                    id: `${vehicle.id}_${vehicle.id2}`,
                    type: 'Feature',
                    properties: {
                        type: 'a-f-G-E-V-A-T-H',
                        how: 'm-g',
                        callsign: `${vehicle.fleet} ${vehicle.type}`,
                        course: typeof position.bearing === 'number' ? position.bearing : undefined,
                        speed: Number(position.speed) * 0.44704,
                        metadata: {
                            fleet: vehicle.fleet,
                            vehicle_type: vehicle.type,
                            vehicle_subtype: vehicle.subtype,
                            current_status_state: current_status.state,
                            current_status_info: current_status.info,
                            collection_timestamp: moment(Math.floor(Number(source.collection_timestamp) * 1000)).tz('America/Denver').format('YYYY-MM-DD HH:mm z'),
                            odometer: position.odometer
                        }
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [
                            position.longitude,
                            position.latitude
                        ]
                    }
                };

                return [feat];
            })
        };

        await this.submit(features);
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}): ReturnType<typeof internal> {
    return internal(await Task.init(import.meta.url), event);
}
