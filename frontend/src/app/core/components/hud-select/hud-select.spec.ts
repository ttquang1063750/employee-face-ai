import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HudSelectComponent } from './hud-select';
import { StaticTranslateLoader } from '../../i18n/translate-loader';

describe('HudSelectComponent', () => {
  let component: HudSelectComponent<string>;
  let fixture: ComponentFixture<HudSelectComponent<string>>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ loader: StaticTranslateLoader, lang: 'vi', fallbackLang: 'vi' }),
      ],
    });
    fixture = TestBed.createComponent<HudSelectComponent<string>>(HudSelectComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('options', [
      { value: 'all', label: 'Tất cả' },
      { value: 'CHECK_IN', label: 'Vào ca' },
      { value: 'CHECK_OUT', label: 'Ra ca' },
    ]);
    fixture.detectChanges();
  });

  // ngAfterViewInit portals the panel onto document.body (see hud-select.ts)
  // to escape ancestors with `backdrop-filter`/`transform` — ngOnDestroy must
  // remove it again, or every test in this file leaks a stray <ul> node.
  afterEach(() => {
    fixture.destroy();
  });

  describe('ControlValueAccessor', () => {
    it('writeValue sets the value', () => {
      component.writeValue('CHECK_IN');
      expect(component.value()).toBe('CHECK_IN');
    });

    it('selectOption updates the value, notifies onChange, and closes the panel', () => {
      const onChange = vi.fn();
      component.registerOnChange(onChange);
      component.toggleOpen();

      component.selectOption({ value: 'CHECK_OUT', label: 'Ra ca' });

      expect(component.value()).toBe('CHECK_OUT');
      expect(onChange).toHaveBeenCalledWith('CHECK_OUT');
      expect(component.isOpen()).toBe(false);
    });

    it('setDisabledState toggles the disabled signal and blocks toggleOpen', () => {
      component.setDisabledState(true);
      expect(component.disabled()).toBe(true);

      component.toggleOpen();
      expect(component.isOpen()).toBe(false);
    });
  });

  describe('selectedLabel', () => {
    it('resolves the label matching the current value', () => {
      component.writeValue('CHECK_OUT');
      expect(component.selectedLabel()).toBe('Ra ca');
    });

    it('is null when no option matches the current value', () => {
      component.writeValue('unknown');
      expect(component.selectedLabel()).toBeNull();
    });
  });

  describe('toggleOpen', () => {
    it('opens and closes the panel', () => {
      expect(component.isOpen()).toBe(false);
      component.toggleOpen();
      expect(component.isOpen()).toBe(true);
      component.toggleOpen();
      expect(component.isOpen()).toBe(false);
    });
  });
});
