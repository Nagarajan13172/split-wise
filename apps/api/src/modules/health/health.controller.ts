import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** Liveness — process is up. Never fails as long as the request is served. */
  @Get('healthz')
  @HttpCode(200)
  liveness() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness — DB + Redis reachable. Used by load balancer for traffic gating. */
  @Get('readyz')
  async readiness() {
    return this.health.check();
  }
}
