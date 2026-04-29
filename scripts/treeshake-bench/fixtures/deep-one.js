/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Deepest available subpath import for Tearsheet. The default `exports`
 * field on `@carbon/ibm-products` does not yet expose per-component
 * subpaths, but the published `es/` tree is reachable via the tilde
 * fallback because `files` includes `es`. We prefer the resolved file
 * path so the fixture works whether or not an `exports` map is added.
 */

import { Tearsheet } from '@carbon/ibm-products/es/components/Tearsheet/Tearsheet.js';

export default Tearsheet;
