import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

// Shared text-input-with-dropdown-suggestions widget, extracted after the
// same shape (FormControl<string> + show/hide signal + 150ms blur-before-
// mousedown debounce + identical .hud-autocomplete* markup) was duplicated
// verbatim between the dashboard's employee-name search and the compose
// message page's recipient picker (see AGENTS.md rule 22). Wraps a native
// <input> as a ControlValueAccessor the same way HudSelectComponent wraps a
// custom dropdown trigger — the parent still owns filtering (`suggestions`
// input, already computed/capped) and what "selecting an item" means
// (`optionSelected` output), this component only owns the open/close/
// text-echo mechanics.
@Component({
  selector: 'app-hud-autocomplete',
  standalone: true,
  imports: [],
  templateUrl: './hud-autocomplete.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => HudAutocompleteComponent),
      multi: true,
    },
  ],
})
export class HudAutocompleteComponent<T> implements ControlValueAccessor {
  suggestions = input<T[]>([]);
  placeholder = input<string>('Tìm kiếm...');
  inputId = input<string>('');
  icon = input<string>('👤');
  itemLabel = input.required<(item: T) => string>();
  itemMeta = input<(item: T) => string>(() => '');

  optionSelected = output<T>();

  value = signal<string>('');
  isOpen = signal<boolean>(false);
  disabled = signal<boolean>(false);

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- overwritten by registerOnChange/registerOnTouched
  private onChange: (value: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- overwritten by registerOnChange/registerOnTouched
  private onTouched: () => void = () => {};

  writeValue(value: string): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  onInput(text: string): void {
    this.value.set(text);
    this.onChange(text);
    this.isOpen.set(true);
  }

  openPanel(): void {
    this.isOpen.set(true);
  }

  // Same 150ms delay both call sites already used before extraction — long
  // enough for an option's (mousedown) to fire before blur closes the list.
  closePanel(): void {
    setTimeout(() => {
      this.isOpen.set(false);
      this.onTouched();
    }, 150);
  }

  selectOption(item: T): void {
    const label = this.itemLabel()(item);
    this.value.set(label);
    this.onChange(label);
    this.isOpen.set(false);
    this.optionSelected.emit(item);
  }
}
