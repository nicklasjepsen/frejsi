import { TextInput, type TextInputProps } from "./TextInput";
export function NumberInput(props: Omit<TextInputProps, "type">) {
  return <TextInput inputMode="decimal" {...props} type="number" />;
}
