/**
 * Routing Module Exports
 */

export { 
  GeoRouter, 
  LocationResolver, 
  RoutingPolicyEngine,
  createGeoRouter,
  createLocationResolver,
  createRoutingPolicyEngine,
  geoRouter,
  locationResolver,
  routingPolicyEngine
} from './geoRouter'

export type { 
  GeoLocation, 
  NodeGeoInfo, 
  RoutingConfig, 
  RoutingResult,
  RoutingStrategy,
  RoutingPolicy
} from './geoRouter'
