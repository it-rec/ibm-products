/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `@carbon/ibm-products-web-components` does not currently expose a root
 * `"."` entry in its `exports` map, so the published package cannot be
 * barrel-imported as `from '@carbon/ibm-products-web-components'` from a
 * consumer using `exports`-aware resolution. We deep-import the only
 * documented public path (`./es/<file>`) which is what the package's
 * README points users at.
 *
 * Side-effect: registers the `<c4p-tearsheet>` custom element.
 */

import CDSTearsheet from '@carbon/ibm-products-web-components/es/components/tearsheet/tearsheet.js';

export default CDSTearsheet;
