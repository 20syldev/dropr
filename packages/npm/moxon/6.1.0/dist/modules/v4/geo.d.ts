export interface GeoResult {
    distance: {
        km: number;
        miles: number;
        nauticalMiles: number;
    };
    bearing: {
        degrees: number;
        cardinal: string;
    };
    from: {
        lat: number;
        lon: number;
    };
    to: {
        lat: number;
        lon: number;
    };
}
/**
 * Calculates the great-circle distance and bearing between two geographic coordinates.
 *
 * @param lat1 - Latitude of the first point (-90 to 90)
 * @param lon1 - Longitude of the first point (-180 to 180)
 * @param lat2 - Latitude of the second point (-90 to 90)
 * @param lon2 - Longitude of the second point (-180 to 180)
 * @returns Distance in km/miles/nautical miles, compass bearing, and both coordinates
 * @throws Error if any coordinate is out of range or not a number
 */
export default function geo(lat1: string, lon1: string, lat2: string, lon2: string): GeoResult;
