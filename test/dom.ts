// Test/script preload: Bun has no DOMParser, so borrow happy-dom's.
import { Window } from 'happy-dom';

const window = new Window();
Object.assign(globalThis, { DOMParser: window.DOMParser });
