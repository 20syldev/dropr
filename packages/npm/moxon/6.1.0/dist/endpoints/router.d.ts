import { Router } from 'express';
import type { Endpoint } from './define.js';
/**
 * Builds the HTTP routes of the declared endpoints, with the required parameter check and the shared error format.
 * A POST-only endpoint also answers GET with a 405, and a version older than its `since` answers 404.
 *
 * @param endpoints - Contracts to serve, each mounted under `/:version`
 * @returns Router to mount before the hand-written routes, so a declared endpoint takes precedence
 */
export declare function build(endpoints: Endpoint[]): Router;
