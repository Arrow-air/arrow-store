/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts for authenticated /admin requests. */
    adminUser?: import('./server/auth').AdminUser;
  }
}
