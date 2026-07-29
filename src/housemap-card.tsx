import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import type { HassLike } from './ha';
// `?inline` gets the raw CSS text instead of Vite auto-injecting a <link>/
// <style> into the host page - we inject it ourselves into the shadow root
// below, transformed for shadow-DOM context (see hostScopedStyles).
import rawStyles from './styles.css?inline';

// styles.css is written for the STANDALONE build, where this app owns the
// entire page: `:root{...}` holds its color tokens, and `body{height:100vh;
// overflow:hidden;...}` makes the app fill the whole viewport. Neither is
// valid unchanged inside a Lovelace card's shadow root: `:root` only ever
// matches the real document root (a shadow tree has none), so those color
// tokens would silently resolve to nothing; and setting `body{height:100vh}`
// from inside a card would reach right through the shadow boundary and break
// scrolling on the REST of the user's dashboard, not just this card. `:host`
// is the shadow-DOM-native equivalent of `:root` (selects the custom element
// itself, from inside its own shadow tree), and the card supplies its own
// sizing instead of assuming it owns the viewport. Doing this as a string
// transform at build time (not a second hand-maintained CSS file) means
// future edits to styles.css automatically carry over to the card build.
const hostScopedStyles = rawStyles
  .replace(/:root/g, ':host')
  .replace(/\bbody\s*\{[^}]*\}/, '')
  .replace(/#root\s*\{[^}]*\}/, '');

// Reproduces what the stripped body{} rule used to provide (background,
// text color, font) directly on :host, so the card looks identical to the
// standalone app - a self-contained dark card regardless of the surrounding
// dashboard's own theme, matching this project's existing "one fixed theme,
// not adapting to host light/dark" decision from the wall-tablet rounds.
const CARD_HOST_CSS = `
:host {
  display: block;
  position: relative;
  height: 100%;
  min-height: 600px;
  overflow: hidden;
  border-radius: 16px;
  background: radial-gradient(circle at top left, #1e3a5f 0, #0f172a 42%, #0b1120 100%);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
.housemapCardMount { height: 100%; }
.housemapCardDesignerLink {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
  font-size: 11px;
  text-decoration: none;
  line-height: 1;
}
.housemapCardDesignerLink:hover { color: #f8fafc; border-color: rgba(148, 163, 184, 0.5); }
`;

// Every HACS install of this card ships pre-built against whichever house's
// house.config.json was checked in at build time (see README - "the house
// itself is one swappable JSON file"). HACS only manages the single JS
// resource named in hacs.json, not the whole repo, so the visual room
// designer (tools/room-designer.html) can't ride along as a second
// HACS-downloaded file - it's served instead from this repo's own GitHub
// Pages, which mirrors the real folder structure (unlike HACS's flat
// single-file copy), so this link works identically for every installer
// without needing their own web server.
const ROOM_DESIGNER_URL = 'https://aldendana.github.io/housemap-card/tools/room-designer.html';

interface HousemapCardConfig {
  type: string;
}

// The real Lovelace card contract: HA instantiates this element, calls
// setConfig() once with the dashboard YAML, then pushes a fresh `hass` object
// through the setter on every single state change in the whole house (not
// just this card's own entities) - so `hass` updates are frequent and must
// stay cheap. React's own reconciliation absorbs that; we just re-render the
// same tree with new props each time rather than doing anything manual.
class HousemapCard extends HTMLElement {
  private _hass?: HassLike;
  private _config: HousemapCardConfig = { type: 'custom:housemap-card' };
  private _root?: Root;
  private _mount?: HTMLDivElement;

  setConfig(config: HousemapCardConfig) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass: HassLike) {
    this._hass = hass;
    this._render();
  }

  get hass(): HassLike | undefined {
    return this._hass;
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    this._root?.unmount();
    this._root = undefined;
  }

  // Rough size in Lovelace's 50px-per-unit masonry grid - this app is a full
  // room-control dashboard, not a small stat tile, so it wants real height.
  getCardSize() {
    return 8;
  }

  private _ensureShadow(): ShadowRoot {
    if (this.shadowRoot) return this.shadowRoot;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = hostScopedStyles + CARD_HOST_CSS;
    shadow.appendChild(style);
    this._mount = document.createElement('div');
    this._mount.className = 'housemapCardMount';
    shadow.appendChild(this._mount);

    const link = document.createElement('a');
    link.className = 'housemapCardDesignerLink';
    link.href = ROOM_DESIGNER_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = 'Draw your own rooms - opens the room designer in a new tab';
    link.textContent = '⚙️ Edit rooms';
    shadow.appendChild(link);

    return shadow;
  }

  private _render() {
    if (!this._hass) return;
    const shadow = this._ensureShadow();
    if (!this._root) {
      this._root = createRoot(this._mount!);
    }
    this._root.render(<App hass={this._hass} portalRoot={shadow} />);
  }
}

if (!customElements.get('housemap-card')) {
  customElements.define('housemap-card', HousemapCard);
}

// Registers this card in Lovelace's own "Add Card" picker UI (the searchable
// card gallery in the dashboard editor) - without this it still works fine
// via manual YAML (`type: custom:housemap-card`), just isn't visually listed.
declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview?: boolean }>;
  }
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'housemap-card',
  name: 'House Map',
  description: 'Interactive floorplan dashboard: tap a room for lights, climate, and blinds control, plus a whole-house overview panel with weather, alarm, and presence.',
  preview: false,
});
