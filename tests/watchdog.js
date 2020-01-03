/**
 * @license Copyright (c) 2003-2019, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/* globals setTimeout, window, console, document */

import Watchdog from '../src/watchdog';
import Editor from '@ckeditor/ckeditor5-core/src/editor/editor';
import ClassicTestEditor from '@ckeditor/ckeditor5-core/tests/_utils/classictesteditor';
import CKEditorError from '@ckeditor/ckeditor5-utils/src/ckeditorerror';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import { expectToThrowCKEditorError } from '@ckeditor/ckeditor5-utils/tests/_utils/utils';
import HtmlDataProcessor from '@ckeditor/ckeditor5-engine/src/dataprocessor/htmldataprocessor';
import { destroyEditorOrphans } from '@ckeditor/ckeditor5-core/tests/_utils/cleanup';

describe( 'Watchdog', () => {
	let element;

	beforeEach( () => {
		element = document.createElement( 'div' );
		document.body.appendChild( element );
	} );

	afterEach( () => {
		element.remove();
		sinon.restore();
	} );

	describe( 'create()', () => {
		it( 'should create an editor instance', () => {
			const watchdog = new Watchdog();

			const editorCreateSpy = sinon.spy( ClassicTestEditor, 'create' );
			const editorDestroySpy = sinon.spy( ClassicTestEditor.prototype, 'destroy' );

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			return watchdog.create( element, {} )
				.then( () => {
					sinon.assert.calledOnce( editorCreateSpy );
					sinon.assert.notCalled( editorDestroySpy );

					return watchdog.destroy();
				} )
				.then( () => {
					sinon.assert.calledOnce( editorCreateSpy );
					sinon.assert.calledOnce( editorDestroySpy );
				} );
		} );

		it( 'should throw an error when the creator is not defined', () => {
			const watchdog = new Watchdog();

			expectToThrowCKEditorError(
				() => watchdog.create(),
				/^watchdog-creator-not-defined/,
				null
			);
		} );

		it( 'should not throw an error when the destructor is not defined', async () => {
			const watchdog = new Watchdog();
			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			await watchdog.create();

			return watchdog.destroy();
		} );

		it( 'should properly copy the config', () => {
			const watchdog = new Watchdog();
			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			const config = {
				foo: [],
				bar: document.createElement( 'div' )
			};

			return watchdog.create( element, config ).then( () => {
				expect( watchdog.editor.config._config.foo ).to.not.equal( config.foo );
				expect( watchdog.editor.config._config.bar ).to.equal( config.bar );

				return watchdog.destroy();
			} );
		} );

		it( 'should support editor data passed as the first argument', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( data, config ) => ClassicTestEditor.create( data, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			const windowErrorSpy = sinon.spy();
			window.onerror = windowErrorSpy;

			return watchdog.create( '<p>foo</p>', { plugins: [ Paragraph ] } )
				.then( () => {
					expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

					return new Promise( res => {
						setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

						watchdog.on( 'restart', () => {
							window.onerror = originalErrorHandler;
							res();
						} );
					} );
				} )
				.then( () => {
					expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

					return watchdog.destroy();
				} );
		} );
	} );

	describe( 'editor', () => {
		it( 'should be the current editor instance', () => {
			const watchdog = Watchdog.for( ClassicTestEditor );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			const windowErrorSpy = sinon.spy();
			window.onerror = windowErrorSpy;

			expect( watchdog.editor ).to.be.null;

			let oldEditor;

			return watchdog.create( element, {} )
				.then( () => {
					oldEditor = watchdog.editor;
					expect( watchdog.editor ).to.be.instanceOf( ClassicTestEditor );

					return new Promise( res => {
						setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

						watchdog.on( 'restart', () => {
							window.onerror = originalErrorHandler;
							res();
						} );
					} );
				} )
				.then( () => {
					expect( watchdog.editor ).to.be.instanceOf( ClassicTestEditor );
					expect( watchdog.editor ).to.not.equal( oldEditor );

					return watchdog.destroy();
				} )
				.then( () => {
					expect( watchdog.editor ).to.be.null;
				} );
		} );
	} );

	describe( 'error handling', () => {
		it( 'Watchdog should not restart editor during the initialization', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( el =>
				ClassicTestEditor.create( el )
					.then( () => Promise.reject( new Error( 'foo' ) ) )
			);

			return watchdog.create( element ).then(
				() => { throw new Error( '`watchdog.create()` should throw an error.' ); },
				err => {
					expect( err ).to.be.instanceOf( Error );
					expect( err.message ).to.equal( 'foo' );

					return destroyEditorOrphans();
				}
			);
		} );

		it( 'Watchdog should not restart editor during the destroy', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( el => ClassicTestEditor.create( el ) );
			watchdog.setDestructor( () => Promise.reject( new Error( 'foo' ) ) );

			return Promise.resolve()
				.then( () => watchdog.create( element ) )
				.then( () => watchdog.destroy() )
				.then(
					() => { throw new Error( '`watchdog.create()` should throw an error.' ); },
					err => {
						expect( err ).to.be.instanceOf( Error );
						expect( err.message ).to.equal( 'foo' );

						return destroyEditorOrphans();
					}
				);
		} );

		it( 'Watchdog should not hide intercepted errors', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			const windowErrorSpy = sinon.spy();
			window.onerror = windowErrorSpy;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						sinon.assert.calledOnce( windowErrorSpy );

						// Various browsers will display the error slightly differently.
						expect( windowErrorSpy.getCall( 0 ).args[ 0 ] ).to.match( /foo/ );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should intercept editor errors and restart the editor during the runtime', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should not intercept non-editor errors', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			const editorErrorSpy = sinon.spy();
			watchdog.on( 'error', editorErrorSpy );

			const watchdogErrorHandlerSpy = sinon.spy( watchdog, '_handleError' );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				const error = new Error( 'foo' );

				setTimeout( () => {
					throw error;
				} );

				setTimeout( () => {
					throw 'bar';
				} );

				setTimeout( () => {
					throw null;
				} );

				return new Promise( res => {
					setTimeout( () => {
						window.onerror = originalErrorHandler;

						sinon.assert.notCalled( editorErrorSpy );

						// Assert that only instances of the `Error` class will be checked deeper.
						sinon.assert.calledOnce( watchdogErrorHandlerSpy );
						expect( watchdogErrorHandlerSpy.getCall( 0 ).args[ 0 ] ).to.equal( error );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should not intercept other editor errors', () => {
			const watchdog1 = Watchdog.for( ClassicTestEditor );
			const watchdog2 = Watchdog.for( ClassicTestEditor );

			const config = {
				plugins: []
			};

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return Promise.all( [
				watchdog1.create( element, config ),
				watchdog2.create( element, config )
			] ).then( () => {
				return new Promise( res => {
					const watchdog1ErrorSpy = sinon.spy();
					const watchdog2ErrorSpy = sinon.spy();

					watchdog1.on( 'restart', watchdog1ErrorSpy );
					watchdog2.on( 'restart', watchdog2ErrorSpy );

					setTimeout( () => throwCKEditorError( 'foo', watchdog2.editor ) );

					setTimeout( () => {
						window.onerror = originalErrorHandler;

						sinon.assert.notCalled( watchdog1ErrorSpy );
						sinon.assert.calledOnce( watchdog2ErrorSpy );

						Promise.all( [ watchdog1.destroy(), watchdog2.destroy() ] )
							.then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should intercept editor errors and restart the editor if the editor can be found from the context', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor.model.document ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should intercept editor errors and restart the editor if the editor can be found from the context #2', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', {
					foo: [ 1, 2, 3, {
						bar: new Set( [
							new Map( [
								[ 'foo', 'bar' ],
								[ 0, watchdog.editor ]
							] )
						] )
					} ]
				} ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should crash permanently if the `crashNumberLimit` is reached' +
			' and the average time between errors is lower than `minimumNonErrorTimePeriod` (default values)', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			const errorSpy = sinon.spy();
			watchdog.on( 'error', errorSpy );

			const restartSpy = sinon.spy();
			watchdog.on( 'restart', restartSpy );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo1', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo2', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo3', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo4', watchdog.editor ) );

				return new Promise( res => {
					setTimeout( () => {
						expect( errorSpy.callCount ).to.equal( 4 );
						expect( watchdog.crashes.length ).to.equal( 4 );
						expect( restartSpy.callCount ).to.equal( 3 );

						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should crash permanently if the `crashNumberLimit` is reached' +
			' and the average time between errors is lower than `minimumNonErrorTimePeriod` (custom values)', () => {
			const watchdog = new Watchdog( { crashNumberLimit: 2, minimumNonErrorTimePeriod: 1000 } );

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			const errorSpy = sinon.spy();
			watchdog.on( 'error', errorSpy );

			const restartSpy = sinon.spy();
			watchdog.on( 'restart', restartSpy );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo1', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo2', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo3', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'foo4', watchdog.editor ) );

				return new Promise( res => {
					setTimeout( () => {
						expect( errorSpy.callCount ).to.equal( 3 );
						expect( watchdog.crashes.length ).to.equal( 3 );
						expect( restartSpy.callCount ).to.equal( 2 );

						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should not crash permantently when average time between errors is longer than `minimumNonErrorTimePeriod`', () => {
			const watchdog = new Watchdog( { crashNumberLimit: 2, minimumNonErrorTimePeriod: 0 } );

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			const errorSpy = sinon.spy();
			watchdog.on( 'error', errorSpy );

			const restartSpy = sinon.spy();
			watchdog.on( 'restart', restartSpy );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo1', watchdog.editor ), 5 );
				setTimeout( () => throwCKEditorError( 'foo2', watchdog.editor ), 10 );
				setTimeout( () => throwCKEditorError( 'foo3', watchdog.editor ), 15 );
				setTimeout( () => throwCKEditorError( 'foo4', watchdog.editor ), 20 );

				return new Promise( res => {
					setTimeout( () => {
						expect( errorSpy.callCount ).to.equal( 4 );
						expect( watchdog.crashes.length ).to.equal( 4 );
						expect( restartSpy.callCount ).to.equal( 4 );

						window.onerror = originalErrorHandler;

						watchdog.destroy().then( res );
					}, 20 );
				} );
			} );
		} );

		it( 'Watchdog should warn if the CKEditorError missing its context', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );
			watchdog.setDestructor( editor => editor.destroy() );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			sinon.stub( console, 'warn' );

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo' ) );

				return new Promise( res => {
					setTimeout( () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.crashes ).to.deep.equal( [] );

						sinon.assert.calledWithExactly(
							console.warn,
							'The error is missing its context and Watchdog cannot restart the proper editor.'
						);

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should omit error if the CKEditorError context is equal to null', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', null ) );

				return new Promise( res => {
					setTimeout( () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.crashes ).to.deep.equal( [] );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'editor should be restarted with the data before the crash #1', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'editor should be restarted with the data before the crash #2', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const doc = watchdog.editor.model.document;

				watchdog.editor.model.change( writer => {
					writer.insertText( 'bar', writer.createPositionAt( doc.getRoot(), 1 ) );
				} );

				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p><p>bar</p>' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'editor should be restarted with the data of the latest document version before the crash', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const model = watchdog.editor.model;
				const doc = model.document;

				// Decrement the document version to simulate a situation when an operation
				// don't produce new document version.
				doc.version--;

				model.change( writer => {
					writer.insertText( 'bar', writer.createPositionAt( doc.getRoot(), 1 ) );
				} );

				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'editor should be restarted with the latest available data before the crash', () => {
			const watchdog = new Watchdog();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			sinon.stub( console, 'error' );

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const editorGetDataError = new Error( 'Some error' );
				const getDataStub = sinon.stub( watchdog.editor.data, 'get' )
					.throwsException( editorGetDataError );
				// Keep the reference to cleanly destroy it at in the end, as during the TC it
				// throws an exception during destruction.
				const firstEditor = watchdog.editor;

				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					const doc = watchdog.editor.model.document;

					watchdog.editor.model.change( writer => {
						writer.insertText( 'bar', writer.createPositionAt( doc.getRoot(), 1 ) );
					} );

					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						// It is called second time by during the default editor destruction
						// to update the source element.
						sinon.assert.calledTwice( getDataStub );

						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

						sinon.assert.calledWith(
							console.error,
							editorGetDataError,
							'An error happened during restoring editor data. Editor will be restored from the previously saved data.'
						);

						sinon.assert.calledWith(
							console.error,
							'An error happened during the editor destructing.'
						);

						watchdog.destroy().then( () => {
							getDataStub.restore();
							return firstEditor.destroy();
						} ).then( res );
					} );
				} );
			} );
		} );

		it( 'should use the custom destructor if passed', () => {
			const watchdog = new Watchdog();
			const destructionSpy = sinon.spy();

			watchdog.setCreator( ( el, config ) => ClassicTestEditor.create( el, config ) );
			watchdog.setDestructor( editor => {
				destructionSpy();
				return editor.destroy();
			} );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						sinon.assert.calledOnce( destructionSpy );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );
	} );

	describe( 'async error handling', () => {
		let unhandledRejectionEventSupported;

		before( () => {
			return isUnhandledRejectionEventSupported()
				.then( val => {
					unhandledRejectionEventSupported = val;
				} );
		} );

		it( 'Watchdog should handle async CKEditorError errors', () => {
			if ( !unhandledRejectionEventSupported ) {
				return;
			}

			const watchdog = Watchdog.for( ClassicTestEditor );
			const originalErrorHandler = window.onerror;

			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const oldEditor = watchdog.editor;

				Promise.resolve().then( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.editor ).to.not.equal( oldEditor );
						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'Watchdog should not react to non-editor async errors', () => {
			if ( !unhandledRejectionEventSupported ) {
				return;
			}

			const watchdog = Watchdog.for( ClassicTestEditor );
			const originalErrorHandler = window.onerror;
			const editorErrorSpy = sinon.spy();

			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				watchdog.on( 'error', editorErrorSpy );

				Promise.resolve().then( () => Promise.reject( 'foo' ) );
				Promise.resolve().then( () => Promise.reject( new Error( 'bar' ) ) );

				// Wait a cycle.
				return new Promise( res => setTimeout( res ) );
			} ).then( () => {
				window.onerror = originalErrorHandler;

				sinon.assert.notCalled( editorErrorSpy );
				expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

				return watchdog.destroy();
			} );
		} );
	} );

	describe( 'destroy()', () => {
		// See #19.
		it( 'should clean internal stuff', () => {
			// 30ms should be enough to make the two data changes split into two data save actions.
			// This will ensure that the second data save action will be put off in time.
			const SAVE_INTERVAL = 30;

			const watchdog = Watchdog.for( ClassicTestEditor, {
				saveInterval: SAVE_INTERVAL,
			} );

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const doc = watchdog.editor.model.document;

				watchdog.editor.model.change( writer => {
					writer.insertText( 'bar', writer.createPositionAt( doc.getRoot(), 1 ) );
				} );

				watchdog.editor.model.change( writer => {
					writer.insertText( 'foo', writer.createPositionAt( doc.getRoot(), 1 ) );
				} );

				return watchdog.destroy();
			} ).then( () => {
				// Wait to ensure that the throttled save is cleared and won't be executed
				// on the non-existing editor.
				return new Promise( res => setTimeout( res, SAVE_INTERVAL ) );
			} ).then( () => {
				expect( watchdog.editor ).to.equal( null );
				expect( watchdog.state ).to.equal( 'destroyed' );
				expect( watchdog.crashes ).to.deep.equal( [] );
			} );
		} );
	} );

	describe( 'static for()', () => {
		it( 'should be a shortcut method for creating the watchdog', () => {
			const watchdog = Watchdog.for( ClassicTestEditor );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element, {
				initialData: '<p>foo</p>',
				plugins: [ Paragraph ]
			} ).then( () => {
				const oldEditor = watchdog.editor;
				expect( watchdog.editor ).to.be.an.instanceOf( ClassicTestEditor );

				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

				return new Promise( res => {
					watchdog.on( 'restart', () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.editor ).to.be.an.instanceOf( ClassicTestEditor );
						expect( watchdog.editor ).to.not.equal( oldEditor );
						expect( watchdog.editor.getData() ).to.equal( '<p>foo</p>' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );
	} );

	describe( 'crashes', () => {
		it( 'should be an array of caught errors by the watchdog', () => {
			const watchdog = Watchdog.for( ClassicTestEditor );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );
				setTimeout( () => throwCKEditorError( 'bar', watchdog.editor ) );

				return new Promise( res => {
					setTimeout( () => {
						window.onerror = originalErrorHandler;

						expect( watchdog.crashes[ 0 ].message ).to.equal( 'foo' );
						expect( watchdog.crashes[ 0 ].stack ).to.be.a( 'string' );
						expect( watchdog.crashes[ 0 ].date ).to.be.a( 'number' );
						expect( watchdog.crashes[ 0 ].filename ).to.be.a( 'string' );
						expect( watchdog.crashes[ 0 ].lineno ).to.be.a( 'number' );
						expect( watchdog.crashes[ 0 ].colno ).to.be.a( 'number' );

						expect( watchdog.crashes[ 1 ].message ).to.equal( 'bar' );

						watchdog.destroy().then( res );
					} );
				} );
			} );
		} );

		it( 'should include async errors', () => {
			return isUnhandledRejectionEventSupported().then( isSupported => {
				if ( !isSupported ) {
					return;
				}

				const watchdog = Watchdog.for( ClassicTestEditor );

				// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
				const originalErrorHandler = window.onerror;
				window.onerror = undefined;

				return watchdog.create( element ).then( () => {
					Promise.resolve().then( () => throwCKEditorError( 'foo', watchdog.editor ) );

					return new Promise( res => {
						// This `setTimeout` needs to have a timer defined because Firefox calls the code in random order
						// and causes the test failed.
						setTimeout( () => {
							window.onerror = originalErrorHandler;

							expect( watchdog.crashes[ 0 ].message ).to.equal( 'foo' );
							expect( watchdog.crashes[ 0 ].stack ).to.be.a( 'string' );
							expect( watchdog.crashes[ 0 ].date ).to.be.a( 'number' );
							expect( watchdog.crashes[ 0 ].filename ).to.be.an( 'undefined' );
							expect( watchdog.crashes[ 0 ].lineno ).to.be.an( 'undefined' );
							expect( watchdog.crashes[ 0 ].colno ).to.be.an( 'undefined' );

							watchdog.destroy().then( res );
						}, 10 );
					} );
				} );
			} );
		} );
	} );

	describe( 'state', () => {
		let orphanEditors = [];

		afterEach( () => {
			return Promise.all( orphanEditors.map( editor => editor.destroy() ) )
				.then( () => {
					orphanEditors = [];
				} );
		} );

		it( 'should reflect the state of the watchdog', () => {
			const watchdog = Watchdog.for( ClassicTestEditor );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			expect( watchdog.state ).to.equal( 'initializing' );

			return watchdog.create( element ).then( () => {
				orphanEditors.push( watchdog.editor );
				expect( watchdog.state ).to.equal( 'ready' );

				return watchdog.create( element ).then( () => {
					setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );
					setTimeout( () => throwCKEditorError( 'bar', watchdog.editor ) );

					return new Promise( res => {
						setTimeout( () => {
							window.onerror = originalErrorHandler;

							expect( watchdog.state ).to.equal( 'ready' );

							watchdog.destroy().then( () => {
								expect( watchdog.state ).to.equal( 'destroyed' );

								res();
							} );
						} );
					} );
				} );
			} );
		} );

		it( 'should be observable', () => {
			const watchdog = Watchdog.for( ClassicTestEditor );
			const states = [];

			watchdog.on( 'change:state', ( evt, propName, newValue ) => {
				states.push( newValue );
			} );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog.create( element ).then( () => {
				orphanEditors.push( watchdog.editor );

				return watchdog.create( element ).then( () => {
					setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );
					setTimeout( () => throwCKEditorError( 'bar', watchdog.editor ) );
					setTimeout( () => throwCKEditorError( 'baz', watchdog.editor ) );
					setTimeout( () => throwCKEditorError( 'biz', watchdog.editor ) );

					return new Promise( res => {
						setTimeout( () => {
							window.onerror = originalErrorHandler;

							watchdog.destroy().then( () => {
								expect( states ).to.deep.equal( [
									'ready',
									'crashed',
									'initializing',
									'ready',
									'crashed',
									'initializing',
									'ready',
									'crashed',
									'initializing',
									'ready',
									'crashed',
									'crashedPermanently',
									'destroyed'
								] );

								res();
							} );
						} );
					} );
				} );
			} );
		} );
	} );

	describe( 'multi-root editors', () => {
		it( 'should support multi-root editors', () => {
			class MultiRootEditor extends Editor {
				constructor( sourceElements, config ) {
					super( config );

					this.data.processor = new HtmlDataProcessor();

					// Create a root for each source element.
					for ( const rootName of Object.keys( sourceElements ) ) {
						this.model.document.createRoot( '$root', rootName );
					}
				}

				static async create( sourceElements, config ) {
					const editor = new this( sourceElements, config );

					await editor.initPlugins();

					await editor.data.init( config.initialData );

					editor.fire( 'ready' );

					return editor;
				}
			}

			const watchdog = Watchdog.for( MultiRootEditor );

			// sinon.stub( window, 'onerror' ).value( undefined ); and similar do not work.
			const originalErrorHandler = window.onerror;
			window.onerror = undefined;

			return watchdog
				.create( {
					header: element
				}, {
					initialData: {
						header: '<p>Foo</p>'
					},
					plugins: [ Paragraph ]
				} )
				.then( () => {
					expect( watchdog.editor.data.get( { rootName: 'header' } ) ).to.equal( '<p>Foo</p>' );

					setTimeout( () => throwCKEditorError( 'foo', watchdog.editor ) );

					return new Promise( res => {
						window.onerror = originalErrorHandler;
						expect( watchdog.editor.data.get( { rootName: 'header' } ) ).to.equal( '<p>Foo</p>' );

						res();
					} );
				} ).then( () => {
					return watchdog.destroy();
				} );
		} );
	} );
} );

function throwCKEditorError( name, context ) {
	throw new CKEditorError( name, context );
}

// Feature detection works as a race condition - if the `unhandledrejection` event
// is supported then the listener should be called first. Otherwise the timeout will be reached.
function isUnhandledRejectionEventSupported() {
	return new Promise( res => {
		window.addEventListener( 'unhandledrejection', function listener() {
			res( true );

			window.removeEventListener( 'unhandledrejection', listener );
		} );

		Promise.resolve().then( () => Promise.reject( new Error() ) );

		setTimeout( () => res( false ) );
	} );
}
