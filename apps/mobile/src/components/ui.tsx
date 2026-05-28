import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';

export function Screen({ children }: { children: ReactNode }) {
  return <View className="flex-1 bg-slate-50 px-6 py-10">{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text className="text-3xl font-bold tracking-tight text-slate-900">{children}</Text>;
}

export function Sub({ children }: { children: ReactNode }) {
  return <Text className="mt-1 text-sm text-slate-600">{children}</Text>;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View>
      <Text className="text-sm font-medium text-slate-700">{label}</Text>
      <View className="mt-1">{children}</View>
      {error ? <Text className="mt-1 text-xs text-red-600">{error}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#94a3b8"
      className={
        'rounded-md border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 ' +
        (props.className ?? '')
      }
    />
  );
}

export function Button({
  children,
  loading,
  variant = 'primary',
  ...props
}: PressableProps & { children: ReactNode; loading?: boolean; variant?: 'primary' | 'ghost' }) {
  const base = 'flex-row items-center justify-center rounded-md px-4 py-3';
  const styles =
    variant === 'primary' ? 'bg-slate-900 active:bg-slate-800' : 'border border-slate-200 bg-white';
  const text = variant === 'primary' ? 'text-white' : 'text-slate-700';
  return (
    <Pressable {...props} className={`${base} ${styles} ${props.disabled ? 'opacity-60' : ''}`}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#0f172a'} />
      ) : (
        <Text className={`${text} text-base font-medium`}>{children}</Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <View className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
      <Text className="text-sm text-red-700">{error}</Text>
    </View>
  );
}

export function InfoBanner({ children, kind = 'info' }: { children: ReactNode; kind?: 'success' | 'info' }) {
  const styles =
    kind === 'success'
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-slate-200 bg-slate-50';
  const text = kind === 'success' ? 'text-emerald-800' : 'text-slate-700';
  return (
    <View className={`rounded-md border ${styles} px-3 py-2`}>
      <Text className={`text-sm ${text}`}>{children}</Text>
    </View>
  );
}
