import fs from 'fs';
import ETL from '@tak-ps/etl';

try {
    const dotfile = new URL('.env', import.meta.url);

    fs.accessSync(dotfile);

    Object.assign(process.env, JSON.parse(fs.readFileSync(dotfile)));
    console.log('ok - .env file loaded');
} catch (err) {
    console.log('ok - no .env file loaded');
}

export default class Task extends ETL {
    static async schema(type = 'input') {
        if (type === 'input') {
            return {
                type: 'object',
                required: ['COTRIP_TOKEN'],
                properties: {
                    'COTRIP_TOKEN': {
                        type: 'string',
                        description: 'API Token for CoTrip'
                    },
                    'Show Only Active': {
                        type: 'boolean',
                        description: 'Limit Plows to showing only ones that are actively transmitting',
                        default: true
                    },
                    'Show Only Driving': {
                        type: 'boolean',
                        description: 'Limit Plows to showing only ones that are reported as driving',
                        default: true
                    },
                    'DEBUG': {
                        type: 'boolean',
                        default: false,
                        description: 'Print GeoJSON Features in logs'
                    }
                }
            };
        } else {
            return {
                type: 'object',
                required: [],
                properties: {
                    fleet: { type: 'string' },
                    vehicle_type: { type: 'string' },
                    vehicle_subtype: { type: 'string' },
                    current_status_state: { type: 'string' },
                    current_status_info: { type: 'string' },
                    odometer: { type: 'number' }
                }
            };
        }
    }

    async control() {
        const layer = await this.layer();

        const api = 'https://data.cotrip.org/';
        if (!layer.environment.COTRIP_TOKEN) throw new Error('No COTrip API Token Provided');
        const token = layer.environment.COTRIP_TOKEN;

        const plows = [];
        let batch = -1;
        let res;
        do {
            console.log(`ok - fetching page ${++batch}  of plows`);
            const url = new URL('/api/v1/snowPlows', api);
            url.searchParams.append('apiKey', token);
            if (res) url.searchParams.append('offset', res.headers.get('next-offset'));

            res = await fetch(url);

            plows.push(...(await res.json()).features);
        } while (res.headers.has('next-offset') && res.headers.get('next-offset') !== 'None');
        console.log(`ok - fetched ${plows.length} plows`);

        const features = {
            type: 'FeatureCollection',
            features: plows.filter((plow) => {
                if (layer.environment['Show Only Active']) {
                    return !['Inactive', 'Unknown'].includes(plow.avl_location.current_status.state);
                } else {
                    return true;
                }
            }).filter((plow) => {
                if (layer.environment['Show Only Driving']) {
                    return plow.avl_location.current_status.info === 'Driving';
                } else {
                    return true;
                }
            }).map((plow) => {
                const feat = {
                    id: plow.avl_location.vehicle.id + '_' + plow.avl_location.vehicle.id2,
                    type: 'Feature',
                    properties: {
                        type: 'a-f-G-E-V-A-T-H',
                        how: 'm-g',
                        callsign: `${plow.avl_location.vehicle.fleet} ${plow.avl_location.vehicle.type}`,
                        speed: plow.avl_location.position.speed * 0.44704,
                        fleet: plow.avl_location.vehicle.fleet,
                        vehicle_type: plow.avl_location.vehicle.type,
                        vehicle_subtype: plow.avl_location.vehicle.subtype,
                        current_status_state: plow.avl_location.current_status.state,
                        current_status_info: plow.avl_location.current_status.info,
                        odometer: plow.avl_location.position.odometer
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [
                            plow.avl_location.position.longitude,
                            plow.avl_location.position.latitude
                        ]
                    }
                };

                return feat;
            })
        };

        await this.submit(features);
    }
}

export async function handler(event = {}) {
    if (event.type === 'schema:input') {
        return await Task.schema('input');
    } else if (event.type === 'schema:output') {
        return await Task.schema('output');
    } else {
        const task = new Task();
        await task.control();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) handler();


