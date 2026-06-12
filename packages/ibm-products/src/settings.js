/**
 * Copyright IBM Corp. 2024
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

import pkgSettings from './global/js/package-settings';
import { themes } from '@carbon/themes';

export const carbon = {
  get themes() {
    return themes;
  },
  prefix: 'cds',
};

// NOTE: the component-enablement helpers (checkComponentEnabled and
// logDeprecated) deliberately live in
// ./global/js/utils/checkComponentEnabled.js rather than being attached
// to the package settings here: keeping them out of this module (which
// every component imports) allows bundlers to tree-shake the Canary
// placeholder and its dependencies out of applications that only use
// released components.

export const pkg = pkgSettings;
