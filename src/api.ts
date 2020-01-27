import ContextWatchdog from './contextwatchdog';
import Context from '@ckeditor/ckeditor5-core/src/context';

const contextWatchdog = ContextWatchdog.for( Context, {} );

contextWatchdog.add();

contextWatchdog.on( 'error', () => {})
