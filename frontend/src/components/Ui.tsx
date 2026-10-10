import type { ReactNode } from 'react';
import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import classes from './Ui.module.css';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text component="span" className={classes.eyebrow}>{children}</Text>;
}

export function PageHeader({ eyebrow, title, description, back, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return <header className={classes.pageHeader}>
    {back && <Anchor component={Link} to={back.to} className={classes.back}>← {back.label}</Anchor>}
    <Group justify="space-between" align="end" gap="md" wrap="wrap">
      <Stack gap={6} className={classes.headingBlock}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Title order={1} className={classes.pageTitle}>{title}</Title>
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
    {description && <Text c="dimmed" className={classes.description}>{description}</Text>}
  </header>;
}

export function Section({ title, step, actions, children, tone }: { title: ReactNode; step?: number; actions?: ReactNode; children: ReactNode; tone?: 'plain' | 'panel' }) {
  return <section className={tone === 'panel' ? classes.panel : classes.section}>
    <Group justify="space-between" align="center" gap="sm" wrap="wrap" className={classes.sectionHead}>
      <Group gap="sm" wrap="nowrap">
        {step != null && <span className={classes.step} aria-hidden="true">{step}</span>}
        <Title order={2} className={classes.sectionTitle}>{title}</Title>
      </Group>
      {actions}
    </Group>
    <Stack gap="md">{children}</Stack>
  </section>;
}

export function Stat({ label, value, children, size = 'md' }: { label: ReactNode; value: ReactNode; children?: ReactNode; size?: 'md' | 'lg' }) {
  return <div className={classes.stat}>
    <Eyebrow>{label}</Eyebrow>
    <div className={size === 'lg' ? classes.statValueLg : classes.statValue}>{value}</div>
    {children}
  </div>;
}

export function Code({ children }: { children: ReactNode }) {
  return <span className={classes.code}>{children}</span>;
}

export function ConfirmBar({ children }: { children: ReactNode }) {
  return <div className={classes.confirmBar}><Stack gap="sm">{children}</Stack></div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={classes.empty}><Text c="dimmed">{children}</Text></div>;
}
