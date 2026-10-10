import { Alert, AppShell, Badge, Button, Card, createTheme, Input, NavLink, NumberInput, Paper, Select, Table, TextInput, Title, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import classes from './theme.module.css';

const overol: MantineColorsTuple = [
  '#eef3f9', '#dbe5f1', '#b5c9e1', '#8db4e2', '#6a90bf',
  '#5480b6', '#3d6a9e', '#1f3b5c', '#18304b', '#10223a',
];
// Amarillo de seguridad. Solo relleno y decoración; el texto encima siempre es oscuro (#16191D, 9.7:1).
const seguridad: MantineColorsTuple = [
  '#fff9e0', '#fff0b3', '#ffe680', '#ffdb4d', '#f7cb1f',
  '#f2b705', '#d9a300', '#b38600', '#7a5a00', '#5c4300',
];
const gray: MantineColorsTuple = [
  '#f6f5f2', '#edebe6', '#e2e0d9', '#d9d6ce', '#7e8288',
  '#6a6e75', '#5d6168', '#45484e', '#2e3136', '#16191d',
];
const dark: MantineColorsTuple = [
  '#e4e6ea', '#c3c7ce', '#9097a1', '#7a808a', '#6b717b',
  '#2c3036', '#1a1d21', '#121417', '#0d0f11', '#08090a',
];

export const theme = createTheme({
  primaryColor: 'overol',
  primaryShade: { light: 7, dark: 3 },
  colors: { overol, seguridad, gray, dark },
  autoContrast: true,
  luminanceThreshold: 0.4,
  white: '#faf9f6',
  black: '#16191d',
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, monospace',
  headings: {
    fontFamily: '"Barlow Condensed", "IBM Plex Sans", sans-serif',
    fontWeight: '700',
    sizes: {
      h1: { fontSize: 'clamp(2rem, 1.6rem + 1.6vw, 2.75rem)', lineHeight: '1.05' },
      h2: { fontSize: '1.75rem', lineHeight: '1.1' },
      h3: { fontSize: '1.375rem', lineHeight: '1.15' },
      h4: { fontSize: '1.125rem', lineHeight: '1.2' },
    },
  },
  radius: { xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px' },
  defaultRadius: 'sm',
  shadows: { xs: 'none', sm: 'none', md: '0 2px 0 rgba(22, 25, 29, 0.08)', lg: '0 4px 0 rgba(22, 25, 29, 0.1)', xl: '0 6px 0 rgba(22, 25, 29, 0.12)' },
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    AppShell: AppShell.extend({ classNames: { header: classes.header, navbar: classes.navbar, main: classes.main } }),
    // El contraste automático de Mantine se calcula con el tono del modo claro; en botones primarios rellenos
    // usamos la variable por esquema para que en oscuro el texto sea oscuro sobre el azul claro.
    Button: Button.extend({
      defaultProps: { fw: 600 },
      classNames: { root: classes.button },
      vars: (_theme, props) => ({ root: props.color == null && (props.variant ?? 'filled') === 'filled' ? { '--button-color': 'var(--mantine-primary-color-contrast)' } : {} }),
    }),
    Card: Card.extend({ defaultProps: { withBorder: true, padding: 'lg', shadow: 'none' }, classNames: { root: classes.surface } }),
    Paper: Paper.extend({ defaultProps: { withBorder: true, shadow: 'none' }, classNames: { root: classes.surface } }),
    Alert: Alert.extend({ defaultProps: { variant: 'light' }, classNames: { root: classes.alert, title: classes.alertTitle } }),
    Badge: Badge.extend({ defaultProps: { radius: 'xs', variant: 'light' }, classNames: { root: classes.badge } }),
    Title: Title.extend({ classNames: { root: classes.title } }),
    NavLink: NavLink.extend({ classNames: { root: classes.navLink, label: classes.navLinkLabel } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' }, classNames: { table: classes.table, th: classes.th, td: classes.td } }),
    Input: Input.extend({ classNames: { input: classes.input } }),
    TextInput: TextInput.extend({ classNames: { label: classes.label } }),
    NumberInput: NumberInput.extend({ classNames: { label: classes.label } }),
    Select: Select.extend({ classNames: { label: classes.label } }),
  },
});

export const resolver: CSSVariablesResolver = () => ({
  variables: {
    '--kl-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    '--kl-acento': '#f2b705',
    '--kl-acento-contra': '#16191d',
  },
  light: {
    '--mantine-color-body': '#f1f0ec',
    '--mantine-color-text': '#16191d',
    '--mantine-color-dimmed': '#5d6168',
    '--mantine-color-default-border': '#d9d6ce',
    '--mantine-color-anchor': '#1f3b5c',
    '--kl-surface': '#faf9f6',
    '--kl-surface-sunken': '#e9e7e1',
    '--kl-line': '#d9d6ce',
    '--kl-acento-texto': '#7a5a00',
    '--kl-header-bg': '#1f3b5c',
    '--kl-header-text': '#faf9f6',
    '--mantine-primary-color-contrast': '#faf9f6',
  },
  dark: {
    '--mantine-color-body': '#121417',
    '--mantine-color-text': '#e4e6ea',
    '--mantine-color-dimmed': '#9097a1',
    '--mantine-color-default-border': '#2c3036',
    '--mantine-color-anchor': '#8db4e2',
    '--kl-surface': '#1a1d21',
    '--kl-surface-sunken': '#0d0f11',
    '--kl-line': '#2c3036',
    '--kl-acento-texto': '#f2b705',
    '--kl-header-bg': '#0d0f11',
    '--kl-header-text': '#e4e6ea',
    '--mantine-primary-color-contrast': '#16191d',
  },
});
