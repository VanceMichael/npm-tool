import type { FastifyRequest } from 'fastify';
import type { KeyExtractor, CreateRateLimiterOptions } from '../types';

export function normalizeKeyExtractor(
  keyBy: CreateRateLimiterOptions['keyBy']
): KeyExtractor {
  if (!keyBy || keyBy === 'ip') {
    return { type: 'ip' };
  }
  
  if (typeof keyBy === 'object' && keyBy.type === 'header') {
    return {
      type: 'header',
      headerName: keyBy.name,
    };
  }
  
  if (typeof keyBy === 'function') {
    return {
      type: 'custom',
      customFn: keyBy,
    };
  }
  
  throw new Error('Invalid keyBy configuration');
}

export async function extractKey(
  request: FastifyRequest,
  keyExtractor: KeyExtractor
): Promise<string> {
  switch (keyExtractor.type) {
    case 'ip':
      return request.ip || 'unknown';
      
    case 'header':
      const headerValue = request.headers[keyExtractor.headerName!.toLowerCase()];
      if (Array.isArray(headerValue)) {
        return headerValue[0] || 'unknown';
      }
      return headerValue || 'unknown';
      
    case 'custom':
      return keyExtractor.customFn!(request);
      
    default:
      throw new Error(`Unsupported key extractor type: ${keyExtractor.type}`);
  }
}
