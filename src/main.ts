import './ai/install-guard';
import './ui/app.css';
import { boot } from './ui/app';

async function start() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fake-device')) {
    // Dev-only stand-in for the on-device model; dropped from production builds.
    (await import('./dev/fake-device')).installFakeDevice();
  }
  await boot(document.getElementById('app')!);
}
void start();
