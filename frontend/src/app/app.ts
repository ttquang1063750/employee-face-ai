import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HudDialogComponent } from './core/components/hud-dialog/hud-dialog';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HudDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly title = signal('frontend');
}
