import React, { Suspense, lazy } from 'react';
export default function dynamic(loader: () => Promise<any>, options?: any) {
  const Component = lazy(async () => { const value = await loader(); return { default: value.default ?? value }; });
  return function Dynamic(props: any) { return <Suspense fallback={options?.loading ? <options.loading /> : null}><Component {...props} /></Suspense>; };
}
