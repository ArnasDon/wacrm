// Tremor useOnWindowResize hook — copied from tremorlabs/tremor.
// License: Apache 2.0 (Tremor).
// Source: https://github.com/tremorlabs/tremor/blob/main/src/hooks/useOnWindowResize.ts

import * as React from 'react';

export const useOnWindowResize = (handler: () => void) => {
  React.useEffect(() => {
    const handleResize = () => {
      handler();
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [handler]);
};
