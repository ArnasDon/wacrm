import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DropdownMenuGroup, DropdownMenuLabel } from './dropdown-menu';

/**
 * Regression for issue #336 — "clicking Add node reloads the page".
 *
 * DropdownMenuLabel is base-ui's Menu.GroupLabel, which reads a required
 * Menu.Group context and THROWS at render when it's missing. The flow
 * builder's add-node menu wrapped its labels in a plain <div> instead of
 * a DropdownMenuGroup, so opening the menu crashed the whole page. These
 * tests pin the contract so the div-wrapper regression can't come back.
 */
describe('DropdownMenuLabel requires a DropdownMenuGroup ancestor', () => {
  it('throws when rendered without a group (the #336 crash)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(DropdownMenuLabel, null, 'Messaging')
      )
    ).toThrow();
  });

  it('renders when wrapped in a DropdownMenuGroup (the fix)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          DropdownMenuGroup,
          null,
          React.createElement(DropdownMenuLabel, null, 'Messaging')
        )
      )
    ).not.toThrow();
  });
});
