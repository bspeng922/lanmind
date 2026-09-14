import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { ThemeCheckbox } from './ThemeCheckbox';

test('ThemeCheckbox renders with default props', () => {
  let changedValue: boolean | null = null;
  const element = React.createElement(ThemeCheckbox, {
    checked: false,
    onChange: (val: boolean) => {
      changedValue = val;
    },
    label: '测试标签',
    id: 'test-check-1',
  });

  assert.equal(element.type, ThemeCheckbox);
  assert.equal(element.props.checked, false);
  assert.equal(element.props.label, '测试标签');
  assert.equal(element.props.id, 'test-check-1');
  assert.equal(element.props.size, undefined); // defaults to 'md' inside
});

test('ThemeCheckbox supports sm size and disabled state', () => {
  const element = React.createElement(ThemeCheckbox, {
    checked: true,
    onChange: () => {},
    disabled: true,
    size: 'sm',
    ariaLabel: '标记已完成',
    className: 'filter-checkbox-trigger',
  });

  assert.equal(element.props.checked, true);
  assert.equal(element.props.disabled, true);
  assert.equal(element.props.size, 'sm');
  assert.equal(element.props.ariaLabel, '标记已完成');
  assert.equal(element.props.className, 'filter-checkbox-trigger');
});
