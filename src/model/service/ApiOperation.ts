import type { RequestHandler } from 'express';
import type { OpenAPI } from 'openapi-types';

// OpenAPI routes use named scalar parameters, never Express 5 wildcard arrays.
// Keep the operation's apiDoc contract while expressing that route constraint.
export interface OperationFunction extends RequestHandler<Record<string, string>> {
    apiDoc?: OpenAPI.Operation;
}

export interface OperationHandlerArray {
    apiDoc?: OpenAPI.Operation;
    [index: number]: RequestHandler<Record<string, string>>;
}

export type Operation = OperationFunction | OperationHandlerArray;
